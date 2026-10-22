import { pool } from '../db';
import type { OutboxPublisher } from './broker';

export interface RelayOpts {
  batch?: number;
  // demo:crash-relay: кинути виняток РІВНО між publish і UPDATE published_at (змодельований
  // обрив). Подія вже в черзі, published_at лишається NULL → наступний прогін винесе її вдруге.
  faultBeforeUpdate?: boolean;
  onPublish?: () => void; // демо рахує фактичні публікації в брокер
}
export interface RelayResult {
  published: number;
}

// Одна ітерація relay-воркера на polling. Уся ітерація — ОДНА транзакція на ОДНОМУ клієнті
// пулу (pool.connect, не pool.query('BEGIN')): інакше BEGIN і COMMIT поїдуть у різні зʼєднання.
//
//   SELECT ... WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT N
//     → publish → UPDATE published_at
//
// Саме SKIP LOCKED (а не голий FOR UPDATE): кілька relay-воркерів розбирають РІЗНІ рядки, не
// блокуючись один на одному (ціна — 0 дублів у FOR UPDATE ↔ 0 паралельності). published_at IS
// NULL, а не курсор по id: bigserial видає номер на nextval, а видимим рядок стає на COMMIT,
// тож «усі id > останнього» пропускав би рядки, що закомітились пізніше з меншим id.
export async function relayOnce(pub: OutboxPublisher, opts: RelayOpts = {}): Promise<RelayResult> {
  const batch = opts.batch ?? 10;
  const client = await pool.connect();
  let published = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, payload FROM outbox
         WHERE published_at IS NULL
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
      [batch],
    );
    for (const row of rows) {
      const payloadJson: string =
        typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
      const messageId: string = JSON.parse(payloadJson).eventId;

      // ПОРЯДОК НЕЗМІННИЙ: спершу publish, ПОТІМ UPDATE published_at. Якщо поміняти місцями,
      // відмова publish дасть «позначили винесеним, але не віддали» — тобто ВТРАТУ. Вибір тут
      // не між добре/погано, а між дублем і втратою: дубль лікується дедупом, втрата — нічим.
      await pub.publish(payloadJson, messageId);
      published++;
      opts.onPublish?.();

      if (opts.faultBeforeUpdate) {
        throw new Error('RELAY-CRASH: змодельований обрив рівно між publish і UPDATE published_at');
      }

      await client.query(
        `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [row.id],
      );
    }
    await client.query('COMMIT');
    return { published };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
