import { pool } from '../db';

// Канонічне джерело схеми ДЗ #22 — міграція 1792681513324-Outbox. Тут CREATE ... IF NOT
// EXISTS лише як запобіжник, щоб демо стартували на свіжій БД навіть без `npm run migrate`
// (ідемпотентно, тими самими іменами/типами). Жоден критерій на імена таблиць не дивиться.
export async function ensureOutboxSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      aggregate_type text NOT NULL,
      aggregate_id   text NOT NULL,
      type           text NOT NULL,
      payload        jsonb NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      published_at   timestamptz,
      attempts       integer NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
      ON outbox (created_at, id) WHERE published_at IS NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id text NOT NULL,
      consumer   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, consumer)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_confirmations (
      order_id     bigint PRIMARY KEY,
      confirmed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key        text PRIMARY KEY,
      order_id   bigint,
      body_hash  text,
      response   jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

const BUYER_EMAIL = 'outbox-buyer@shop.local';
const SELLER_EMAIL = 'outbox-seller@shop.local';
const PRODUCT_TITLE = 'OUTBOX-DEMO-PRODUCT';
const BIG_BALANCE_CENTS = 100_000_000; // надлишковий баланс — обмежувати демо не має він
const BIG_STOCK = 1_000_000; // надлишковий stock — так само

export interface OutboxFixtures {
  buyerId: string;
  sellerId: string;
  productId: string;
}

// Самодостатні фікстури: продавець, покупець із балансом, товар зі stock. find-or-create
// за природними ключами (email / seller_id+title), тож повторний запуск нічого не дублює.
export async function ensureFixtures(): Promise<OutboxFixtures> {
  const seller = await pool.query(
    `INSERT INTO users (email, full_name) VALUES ($1, 'Outbox Seller')
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [SELLER_EMAIL],
  );
  const sellerId = String(seller.rows[0].id);

  const buyer = await pool.query(
    `INSERT INTO users (email, full_name, balance_cents) VALUES ($1, 'Outbox Buyer', $2)
     ON CONFLICT (email) DO UPDATE SET balance_cents = EXCLUDED.balance_cents
     RETURNING id`,
    [BUYER_EMAIL, BIG_BALANCE_CENTS],
  );
  const buyerId = String(buyer.rows[0].id);

  const existing = await pool.query(
    `SELECT id FROM products WHERE seller_id = $1 AND title = $2 LIMIT 1`,
    [sellerId, PRODUCT_TITLE],
  );
  let productId: string;
  if (existing.rowCount === 0) {
    const created = await pool.query(
      `INSERT INTO products (seller_id, title, price_cents, stock) VALUES ($1, $2, 1000, $3)
       RETURNING id`,
      [sellerId, PRODUCT_TITLE, BIG_STOCK],
    );
    productId = String(created.rows[0].id);
  } else {
    productId = String(existing.rows[0].id);
    await pool.query(`UPDATE products SET stock = $2, price_cents = 1000 WHERE id = $1`, [
      productId,
      BIG_STOCK,
    ]);
  }
  return { buyerId, sellerId, productId };
}

// Самоочищення: прибираємо стан попередніх прогонів, щоб числа демо були детерміновані.
// orders цього покупця каскадно забирають order_items і tasks (FK ON DELETE CASCADE).
export async function resetDemoState(buyerId: string): Promise<void> {
  await pool.query('TRUNCATE outbox, processed_messages, order_confirmations, idempotency_keys RESTART IDENTITY');
  await pool.query('DELETE FROM orders WHERE buyer_id = $1', [buyerId]);
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params);
  return r.rows[0].n;
}
export const countOrders = (buyerId: string): Promise<number> =>
  count('SELECT count(*)::int AS n FROM orders WHERE buyer_id = $1', [buyerId]);
export const countOutbox = (): Promise<number> => count('SELECT count(*)::int AS n FROM outbox');
export const countPublished = (): Promise<number> =>
  count('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NOT NULL');
export const countConfirmations = (): Promise<number> =>
  count('SELECT count(*)::int AS n FROM order_confirmations');
export const countProcessed = (): Promise<number> =>
  count('SELECT count(*)::int AS n FROM processed_messages');
