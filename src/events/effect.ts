import { pool } from '../db';

// Сховище оброблених подій — у Postgres, НЕ в памʼяті процесу. Set/Map не рахується:
// гарантія живе рівно стільки, скільки інстанс, і не існує між двома подами. Таблиця
// переживає рестарт споживача. Створюємо idempotently, щоб демо не залежали від migrate.
export async function ensureEffectStore(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id   text PRIMARY KEY,
      order_id   text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

// Ідемпотентний ефект через ПРИРОДНИЙ ключ (event_id): INSERT ... ON CONFLICT DO NOTHING,
// а не UPDATE qty = qty - 1. rowCount === 1 → вставили (ефект застосовано вперше);
// 0 → подію вже бачили (дубль), ефект мовчки пропущено. Саме це робить повторну доставку
// безпечною: at-least-once доставка + ідемпотентний ефект = exactly-once РЕЗУЛЬТАТ.
export async function applyEffectOnce(
  eventId: string,
  orderId: string,
): Promise<{ applied: boolean }> {
  const res = await pool.query(
    `INSERT INTO processed_events (event_id, order_id)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, orderId],
  );
  return { applied: res.rowCount === 1 };
}
