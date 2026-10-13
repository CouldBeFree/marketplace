import { pool } from './db';
import { connect } from './events/connection';
import { assertTopology, purgeAll, QUEUE, DLQ, PREFETCH } from './events/topology';
import { createPublisher } from './events/publisher';
import { startConsumer } from './events/consumer';
import { ensureEffectStore } from './events/effect';
import { waitUntil } from './events/wait';

// demo:dlq — DLQ як окремий контур. Публікуємо свідомо биле повідомлення (валідний JSON,
// але не наш контракт order.placed). Споживач робить reject(requeue=false) → лист іде в DLX
// → DLQ. Читаємо причину смерті з x-death / x-first-death-reason. Очікуємо: work=0, dlq=1,
// dlq-reason=rejected, effect=0.
const REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'];

async function main(): Promise<void> {
  await ensureEffectStore();
  const conn = await connect();
  const ch = await assertTopology(conn);
  await purgeAll(ch);

  const consumer = await startConsumer(ch, { prefetch: PREFETCH });
  const publisher = await createPublisher(conn);

  // биле тіло: валідний JSON, але isOrderPlaced() його відкине → DLQ
  await publisher.publishRaw(Buffer.from(JSON.stringify({ garbage: true })), 'poison-1');

  await waitUntil(() => consumer.stats.rejected >= 1, { label: 'споживач відкинув лист' });
  await consumer.stop();

  // чекаємо появи листа в DLQ, читаємо причину НЕ руйнуючи чергу (get → nack(requeue=true))
  await waitUntil(async () => (await ch.checkQueue(DLQ)).messageCount >= 1, {
    label: 'лист зʼявився в DLQ',
  });

  const dead = await ch.get(DLQ, { noAck: false });
  let reason = '';
  if (dead) {
    const headers = (dead.properties.headers ?? {}) as Record<string, any>;
    reason = headers['x-first-death-reason'] ?? headers['x-death']?.[0]?.reason ?? '';
    ch.nack(dead, false, true); // повертаємо в DLQ, щоб глибина лишилась 1
  }

  await waitUntil(async () => (await ch.checkQueue(DLQ)).messageCount >= 1, {
    label: 'лист повернувся в DLQ',
  });

  const workDepth = (await ch.checkQueue(QUEUE)).messageCount;
  const dlqDepth = (await ch.checkQueue(DLQ)).messageCount;
  const s = consumer.stats;

  console.log(`rejected=${s.rejected}`);
  console.log(`work=${workDepth}`);
  console.log(`dlq=${dlqDepth}`);
  console.log(`dlq-reason=${reason}`);
  console.log(`effect=${s.effect}`);

  await publisher.close();
  await ch.close();
  await conn.close();
  await pool.end();

  const ok =
    s.rejected >= 1 &&
    workDepth === 0 &&
    dlqDepth === 1 &&
    REASONS.includes(reason) &&
    s.effect === 0;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:dlq FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
