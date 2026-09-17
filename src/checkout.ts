import { pool } from './db';

export interface CheckoutInput {
  buyerId: string;
  productId: string;
  quantity: number;
}

export type CheckoutResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: 'OUT_OF_STOCK' | 'INSUFFICIENT_FUNDS' };

// Транзакційний checkout: усе в ОДНІЙ транзакції на ОДНОМУ клієнті пулу.
// Захист від oversell — атомарний UPDATE ... WHERE stock >= $n RETURNING:
// 0 рядків = товару немає, це водночас і перевірка, і рядковий лок (без вікна для гонки).
// Будь-яка невдача → ROLLBACK цілої транзакції: замовлень-сиріт не існує.
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const { buyerId, productId, quantity } = input;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
    const orderId: string = orderRes.rows[0].id;

    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
       VALUES ($1, $2, $3, $4)`,
      [orderId, productId, quantity, unitPriceCents],
    );

    // 4) INSERT задача на post-processing (лист/чек — виконає воркер, п.3)
    await client.query(
      `INSERT INTO tasks (order_id, kind, status) VALUES ($1, 'email', 'pending')`,
      [orderId],
    );

    await client.query('COMMIT');
    return { ok: true, orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
