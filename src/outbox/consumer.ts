import type { Channel, ConsumeMessage } from 'amqplib';
import { pool } from '../db';
import { OUTBOX_QUEUE } from './broker';
import { isOrderPlaced } from '../events/order-placed';

export const CONSUMER_NAME = 'order-confirmation';

export interface OutboxConsumerStats {
  delivered: number; // скільки доставок отримав консюмер (at-least-once → може бути > подій)
  effect: number; // скільки разів ефект фактично застосовано (дублі не рахуються)
  skipped: number; // доставки, відсіяні як дубль (повідомлення вже в processed_messages)
  acked: number;
}
export interface OutboxConsumerHandle {
  stats: OutboxConsumerStats;
  stop(): Promise<void>;
}

export async function startOutboxConsumer(
  ch: Channel,
  opts: { prefetch?: number; onProgress?: (s: OutboxConsumerStats) => void } = {},
): Promise<OutboxConsumerHandle> {
  await ch.prefetch(opts.prefetch ?? 10);
  const stats: OutboxConsumerStats = { delivered: 0, effect: 0, skipped: 0, acked: 0 };

  const onMessage = async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) return;
    stats.delivered++;

    let event: unknown;
    try {
      event = JSON.parse(msg.content.toString());
    } catch {
      event = null;
    }
    if (!isOrderPlaced(event)) {
      ch.ack(msg); // у ДЗ #22 без DLQ — просто підтверджуємо, демо білих тіл не шле
      stats.acked++;
      opts.onProgress?.(stats);
      return;
    }

    const { applied } = await applyOnce(event.eventId, event.data.orderId);
    if (applied) stats.effect++;
    else stats.skipped++;

    // ack ПІСЛЯ ефекту: ack означає «я більше не вимагаю повтору», не «дійшло».
    ch.ack(msg);
    stats.acked++;
    opts.onProgress?.(stats);
  };

  const { consumerTag } = await ch.consume(OUTBOX_QUEUE, onMessage, { noAck: false });
  return { stats, stop: async () => { await ch.cancel(consumerTag); } };
}

// Рівень 2 (inbox) + рівень 1 (природний ключ) в ОДНІЙ транзакції на одному клієнті.
// Позначити оброблене в Redis, а ефект записати в Postgres — це знову dual write, тільки в
// профіль. Тому позначка в processed_messages і сам ефект комітяться РАЗОМ або ніяк.
async function applyOnce(messageId: string, orderId: string): Promise<{ applied: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // рівень 2: позначка про обробку цим консюмером. 0 рядків = повідомлення вже бачили.
    const mark = await client.query(
      `INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [messageId, CONSUMER_NAME],
    );
    if (mark.rowCount === 0) {
      await client.query('COMMIT'); // дубль → ефект НЕ повторюємо
      return { applied: false };
    }

    // рівень 1: ефект через ПРИРОДНИЙ ключ (order_id). Повтор нічого не змінює
    // (ON CONFLICT DO NOTHING), на відміну від UPDATE qty = qty - 1, який на другій
    // доставці зняв би вдвічі. Один рядок підтвердження на замовлення.
    await client.query(
      `INSERT INTO order_confirmations (order_id) VALUES ($1) ON CONFLICT (order_id) DO NOTHING`,
      [orderId],
    );

    await client.query('COMMIT');
    return { applied: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
