import { pool } from './db';
import { connect } from './events/connection';
import { assertTopology, purgeAll, PREFETCH } from './events/topology';
import { createPublisher } from './events/publisher';
import { startConsumer } from './events/consumer';
import { makeOrderPlaced } from './events/order-placed';
import { ensureEffectStore } from './events/effect';
import { waitUntil } from './events/wait';

// demo:duplicate ⭐ — серце ДЗ. Одна подія, споживач застосовує ефект і ПІСЛЯ ефекту робить
// nack(requeue=true) рівно раз (імітація падіння до того, як ack доїхав). Брокер повторює
// доставку — на другій ON CONFLICT відсіює ефект, споживач підтверджує. Очікуємо:
// deliveries>=2 (дубль справді стався) і effect=1 (ефект застосовано один раз).
// Саме тут видно очима: exactly-once доставки не існує; at-least-once + ідемпотентний ефект
// = exactly-once РЕЗУЛЬТАТ.
async function main(): Promise<void> {
  await ensureEffectStore();
  const conn = await connect();
  const ch = await assertTopology(conn);
  await purgeAll(ch);

  // requeueOnce: споживач один раз поверне подію в чергу ПІСЛЯ ефекту
  const consumer = await startConsumer(ch, { prefetch: PREFETCH, requeueOnce: true });
  const publisher = await createPublisher(conn);

  await publisher.publish(
    makeOrderPlaced({
      orderId: 'order-dup-1',
      buyerId: 'buyer-1',
      productId: 'prod_1',
      quantity: 1,
      totalCents: 2600,
    }),
  );

  // перша доставка: ефект + nack(requeue=true); друга: ON CONFLICT + ack
  await waitUntil(() => consumer.stats.delivered >= 2 && consumer.stats.acked >= 1, {
    label: 'повторна доставка підтверджена',
  });
  await consumer.stop();

  const s = consumer.stats;
  console.log(`deliveries=${s.delivered}`);
  console.log(`effect=${s.effect}`);
  console.log(`skipped=${s.skipped}`);

  await publisher.close();
  await ch.close();
  await conn.close();
  await pool.end();

  const ok = s.delivered >= 2 && s.effect === 1 && s.skipped >= 1;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:duplicate FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
