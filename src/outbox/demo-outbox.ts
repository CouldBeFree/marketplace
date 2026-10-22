import { pool } from '../db';
import { connect } from '../events/connection';
import { waitUntil } from '../events/wait';
import {
  ensureOutboxSchema,
  ensureFixtures,
  resetDemoState,
  countOrders,
  countOutbox,
  countPublished,
  countConfirmations,
  countProcessed,
} from './schema';
import { assertOutboxTopology, purgeOutboxQueue, createOutboxPublisher } from './broker';
import { startOutboxConsumer } from './consumer';
import { relayOnce } from './relay';
import { checkout } from '../checkout';

// demo:outbox — happy path + ключ ідемпотентності на API-краю.
// ДВА однакові запити з ТИМ САМИМ Idempotency-Key → одне замовлення, один рядок outbox,
// одна подія, один ефект. Потім relay виносить подію в брокер, консюмер застосовує ефект.
// Очікуємо: requests=2 orders=1 outbox=1 published=1 deliveries=1 effect=1 processed=1.
const IDEMPOTENCY_KEY = 'idem-demo-outbox-fixed';

async function main(): Promise<void> {
  await ensureOutboxSchema();
  const { buyerId, productId } = await ensureFixtures();
  await resetDemoState(buyerId);

  const conn = await connect();
  const ch = await assertOutboxTopology(conn);
  await purgeOutboxQueue(ch);

  const consumer = await startOutboxConsumer(ch);
  const publisher = await createOutboxPublisher(conn);

  // два однакові запити з тим самим ключем — другий має схлопнутись у те саме замовлення
  const r1 = await checkout({ buyerId, productId, quantity: 1, idempotencyKey: IDEMPOTENCY_KEY });
  const r2 = await checkout({ buyerId, productId, quantity: 1, idempotencyKey: IDEMPOTENCY_KEY });
  if (!r1.ok || !r2.ok) throw new Error('checkout неуспішний: ' + JSON.stringify([r1, r2]));
  if (r1.orderId !== r2.orderId) {
    throw new Error('ключ ідемпотентності не схлопнув два запити в одне замовлення');
  }

  // relay: outbox → брокер (FOR UPDATE SKIP LOCKED → publish → UPDATE published_at)
  await relayOnce(publisher);

  await waitUntil(() => consumer.stats.delivered >= 1 && consumer.stats.acked >= 1, {
    label: 'подію доставлено й оброблено',
  });
  await consumer.stop();

  const requests = 2;
  const orders = await countOrders(buyerId);
  const outbox = await countOutbox();
  const published = await countPublished();
  const deliveries = consumer.stats.delivered;
  const effect = await countConfirmations();
  const processed = await countProcessed();

  console.log(`requests=${requests}`);
  console.log(`orders=${orders}`);
  console.log(`outbox=${outbox}`);
  console.log(`published=${published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);
  console.log(`processed=${processed}`);

  await publisher.close();
  await ch.close();
  await conn.close();
  await pool.end();

  const ok =
    requests === 2 &&
    orders === 1 &&
    outbox === 1 &&
    published === 1 &&
    deliveries >= 1 &&
    effect === 1 &&
    processed === 1;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:outbox FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
