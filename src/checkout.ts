import { pool } from './db';
import { toOrderPlacedEvent } from './outbox/event';

export interface CheckoutInput {
  buyerId: string;
  productId: string;
  quantity: number;
  // рівень 3 (API-край): ключ ідемпотентності. Той самий ключ + той самий намір → одне
  // замовлення. Ключ ідентифікує НАМІР, не тіло: хеш тіла схлопнув би два легітимні
  // однакові замовлення в одне.
  idempotencyKey?: string;
  // лише для demo:crash-write: змоделювати збій бізнес-запису РІВНО після вставки в outbox,
  // але до COMMIT. Доводить, що order і outbox-рядок — в одній транзакції (ROLLBACK прибирає обидва).
  failAfterOutbox?: boolean;
}

export type CheckoutResult =
  | { ok: true; orderId: string; replayed?: boolean }
  | { ok: false; reason: 'OUT_OF_STOCK' | 'INSUFFICIENT_FUNDS' | 'INVALID_QUANTITY' | 'IN_PROGRESS' };

// Транзакційний checkout: усе в ОДНІЙ транзакції на ОДНОМУ клієнті пулу.
// Захист від oversell — атомарний UPDATE ... WHERE stock >= $n RETURNING:
// 0 рядків = товару немає, це водночас і перевірка, і рядковий лок (без вікна для гонки).
// Будь-яка невдача → ROLLBACK цілої транзакції: замовлень-сиріт не існує.
//
// ДЗ #22: подію про замовлення пишемо рядком у outbox ТІЄЮ Ж транзакцією (замість публікації
// в брокер після COMMIT, як у ДЗ #19 — то був dual write). Доставку бере на себе relay-воркер.
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const { buyerId, productId, quantity, idempotencyKey, failAfterOutbox } = input;

  // валідація вводу: quantity — ЦІЛЕ >= 1. Інакше, напр. -5, дало б stock - (-5)
  // (поповнення складу) і замовлення з відʼємним total. Ловимо ДО відкриття транзакції.
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── рівень 3: ключ ідемпотентності на API-краю ──
    // Застовпити ключ: ON CONFLICT DO NOTHING. 0 рядків = ключ уже бачили → це ПОВТОР наміру,
    // повертаємо вже створене замовлення, без другого order і без другого рядка в outbox.
    if (idempotencyKey) {
      const claim = await client.query(
        `INSERT INTO idempotency_keys (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`,
        [idempotencyKey],
      );
      if (claim.rowCount === 0) {
        const prev = await client.query(
          `SELECT order_id FROM idempotency_keys WHERE key = $1`,
          [idempotencyKey],
        );
        await client.query('COMMIT'); // ми нічого не змінювали
        const prevOrderId = prev.rows[0]?.order_id;
        if (prevOrderId != null) {
          return { ok: true, orderId: String(prevOrderId), replayed: true };
        }
        // ключ застовпили, але замовлення ще не створене (конкурентний in-flight запит).
        // У послідовних демо не трапляється; чесно повертаємо IN_PROGRESS, а не брехливий успіх.
        return { ok: false, reason: 'IN_PROGRESS' };
      }
    }

    // 1) декремент stock із захистом від oversell
    const stockRes = await client.query(
      `UPDATE products SET stock = stock - $2
       WHERE id = $1 AND stock >= $2
       RETURNING price_cents`,
      [productId, quantity],
    );
    if (stockRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OUT_OF_STOCK' };
    }
    const unitPriceCents: number = stockRes.rows[0].price_cents; // integer копійки

    // 2) списання балансу в копійках (ціла арифметика, без float/numeric)
    const balRes = await client.query(
      `UPDATE users SET balance_cents = balance_cents - ($2::int * $3::int)
       WHERE id = $1 AND balance_cents >= ($2::int * $3::int)
       RETURNING id`,
      [buyerId, unitPriceCents, quantity],
    );
    if (balRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    }

    // 3) INSERT замовлення (+ позиція)
    const orderRes = await client.query(
      `INSERT INTO orders (buyer_id, status, shipping_name, total_cents)
       VALUES ($1, 'paid', $2, ($3::int * $4::int))
       RETURNING id`,
      [buyerId, `checkout ${buyerId}`, unitPriceCents, quantity],
    );
    const orderId: string = String(orderRes.rows[0].id);

    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
       VALUES ($1, $2, $3, $4)`,
      [orderId, productId, quantity, unitPriceCents],
    );

    // 4) INSERT задача на post-processing (лист/чек — виконає воркер, ДЗ #14)
    await client.query(
      `INSERT INTO tasks (order_id, kind, status) VALUES ($1, 'email', 'pending')`,
      [orderId],
    );

    // 5) ПОДІЯ — рядком у outbox, ТІЄЮ Ж транзакцією. Жодного publish усередині транзакції:
    // брокер не вміє відкочуватись. Контракт будуємо явно (toOrderPlacedEvent), не spread ORM.
    const event = toOrderPlacedEvent({
      id: orderId,
      buyerId,
      productId,
      quantity,
      totalCents: unitPriceCents * quantity,
    });
    await client.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
       VALUES ('order', $1, $2, $3::jsonb)`,
      [orderId, event.type, JSON.stringify(event)],
    );

    // привʼязуємо ключ ідемпотентності до створеного замовлення (той самий COMMIT)
    if (idempotencyKey) {
      await client.query(`UPDATE idempotency_keys SET order_id = $1 WHERE key = $2`, [
        orderId,
        idempotencyKey,
      ]);
    }

    // demo:crash-write: збій бізнес-запису ПІСЛЯ вставки в outbox, але ДО COMMIT →
    // catch нижче робить ROLLBACK → зникають ОБИДВА рядки (order і outbox).
    if (failAfterOutbox) {
      throw new Error('CRASH-WRITE: змодельований збій бізнес-запису після вставки в outbox');
    }

    await client.query('COMMIT');
    return { ok: true, orderId };
  } catch (err) {
    // не даємо ROLLBACK на мертвому зʼєднанні замаскувати початкову помилку
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
