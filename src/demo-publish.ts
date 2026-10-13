import { pool } from './db';
import { connect } from './events/connection';
import { assertTopology, purgeAll, DLQ, PREFETCH } from './events/topology';
import { createPublisher } from './events/publisher';
import { startConsumer } from './events/consumer';
import { makeOrderPlaced } from './events/order-placed';
import { ensureEffectStore } from './events/effect';
import { waitUntil } from './events/wait';

// demo:publish — happy path + prefetch. Публікуємо 5 подій order.placed, споживач застосовує
// ефект і підтверджує кожну. Очікуємо: published=5, effect=5, acked=5, dlq=0, prefetch=N.
const PUBLISH_COUNT = 5;

async function main(): Promise<void> {
  await ensureEffectStore();
  const conn = await connect();
  const ch = await assertTopology(conn);
  await purgeAll(ch); // чистий старт

  const consumer = await startConsumer(ch, { prefetch: PREFETCH });
  const publisher = await createPublisher(conn);

  // свіжі eventId у кожному прогоні → жодних колізій зі сховищем оброблених подій
  let published = 0;
  for (let i = 0; i < PUBLISH_COUNT; i++) {
    await publisher.publish(
      makeOrderPlaced({
        orderId: `order-pub-${i + 1}`,
        buyerId: 'buyer-1',
        productId: 'prod_1',
        quantity: 1,
        totalCents: 2600,
      }),
    );
    published++;
  }

  // чекаємо, поки консюмер доставить і підтвердить усі
  await waitUntil(() => consumer.stats.acked >= PUBLISH_COUNT, {
    label: 'усі події підтверджено',
  });
  await consumer.stop();

  const dlqDepth = (await ch.checkQueue(DLQ)).messageCount;
  const s = consumer.stats;

  // контракт виводу: один рядок = ключ=значення
  console.log(`published=${published}`);
  console.log(`delivered=${s.delivered}`);
  console.log(`effect=${s.effect}`);
  console.log(`acked=${s.acked}`);
  console.log(`dlq=${dlqDepth}`);
  console.log(`prefetch=${PREFETCH}`);

  await publisher.close();
  await ch.close();
  await conn.close();
  await pool.end();

  // самоперевірка інваріанта: 5 опубліковано → 5 ефектів → 5 ack, нічого в DLQ
  const ok =
    published === PUBLISH_COUNT &&
    s.delivered === PUBLISH_COUNT &&
    s.effect === PUBLISH_COUNT &&
    s.acked === PUBLISH_COUNT &&
    dlqDepth === 0;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:publish FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
