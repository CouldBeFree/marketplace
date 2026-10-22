import { pool } from '../db';
import { connect } from '../events/connection';
import { waitUntil } from '../events/wait';
import {
  ensureOutboxSchema,
  ensureFixtures,
  resetDemoState,
  countConfirmations,
  countProcessed,
} from './schema';
import { assertOutboxTopology, purgeOutboxQueue, createOutboxPublisher } from './broker';
import { startOutboxConsumer } from './consumer';
import { relayOnce } from './relay';
import { checkout } from '../checkout';

// demo:crash-relay ⭐ — серце ДЗ. Падає СЛУЖБОВИЙ запис published_at: relay помирає рівно
// МІЖ publish і UPDATE. Форма — ЗМОДЕЛЬОВАНИЙ обрив (виняток у тій самій точці, крок 8
// коду лекції), а не kill -9. Має статись: подія публікується ВДРУГЕ, а ефект лишається ОДИН.
// Це доводить: доставка at-least-once, exactly-once дає не брокер, а ідемпотентний ефект.
// Очікуємо: deliveries>=2 при applied=1 effect=1 processed=1.
async function main(): Promise<void> {
  await ensureOutboxSchema();
  const { buyerId, productId } = await ensureFixtures();
  await resetDemoState(buyerId);

  const conn = await connect();
  const ch = await assertOutboxTopology(conn);
  await purgeOutboxQueue(ch);

  const consumer = await startOutboxConsumer(ch);
  const publisher = await createOutboxPublisher(conn);

  // одне замовлення → один рядок outbox (published_at = NULL)
  const r = await checkout({ buyerId, productId, quantity: 1 });
  if (!r.ok) throw new Error('checkout неуспішний: ' + JSON.stringify(r));

  let published = 0;

  // ПРОГІН 1 — relay «вмирає» рівно між publish і UPDATE published_at.
  // Подія вже в черзі (publish підтверджений брокером), published_at лишається NULL.
  try {
    await relayOnce(publisher, { faultBeforeUpdate: true, onPublish: () => { published++; } });
    throw new Error('очікувався змодельований обрив relay, але його не сталось');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('RELAY-CRASH')) throw err;
  }

  // ПРОГІН 2 — relay живий: та сама (все ще NULL) подія виноситься ВДРУГЕ, далі UPDATE.
  await relayOnce(publisher, { onPublish: () => { published++; } });

  // дочекатися ДВОХ доставок у консюмера — дубль справді стався
  await waitUntil(() => consumer.stats.delivered >= 2, {
    label: 'подію доставлено щонайменше двічі',
  });
  await consumer.stop();

  const deliveries = consumer.stats.delivered;
  const applied = await countConfirmations(); // ефект через природний ключ — один рядок
  const effect = applied;
  const processed = await countProcessed();

  console.log(`published=${published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`applied=${applied}`);
  console.log(`effect=${effect}`);
  console.log(`processed=${processed}`);

  await publisher.close();
  await ch.close();
  await conn.close();
  await pool.end();

  const ok = deliveries >= 2 && applied === 1 && effect === 1 && processed === 1;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:crash-relay FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
