import { pool } from '../db';
import {
  ensureOutboxSchema,
  ensureFixtures,
  resetDemoState,
  countOrders,
  countOutbox,
  countPublished,
  countConfirmations,
} from './schema';
import { checkout } from '../checkout';

// demo:crash-write — падає БІЗНЕС-запис: транзакція валиться вже ПІСЛЯ вставки рядка в outbox,
// але до COMMIT. Має статись: подія не виходить назовні взагалі, обидва рядки зникають разом.
// Це доказ, що order і outbox-рядок справді в ОДНОМУ COMMIT, а не у двох.
// Брокер тут не потрібен: виносити нема чого. Очікуємо:
//   write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0
async function main(): Promise<void> {
  await ensureOutboxSchema();
  const { buyerId, productId } = await ensureFixtures();
  await resetDemoState(buyerId);

  let writeFailed = 0;
  try {
    // checkout зі збоєм рівно після INSERT у outbox → catch усередині робить ROLLBACK
    await checkout({ buyerId, productId, quantity: 1, failAfterOutbox: true });
    throw new Error('очікувався збій бізнес-запису, але checkout завершився успішно');
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('CRASH-WRITE')) {
      writeFailed = 1; // саме той збій, що ми змоделювали
    } else {
      throw err;
    }
  }

  const orders = await countOrders(buyerId);
  const outbox = await countOutbox();
  const published = await countPublished();
  const effect = await countConfirmations();
  const deliveries = 0; // relay не запускали — немає що виносити

  console.log(`write-failed=${writeFailed}`);
  console.log(`orders=${orders}`);
  console.log(`outbox=${outbox}`);
  console.log(`published=${published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);

  await pool.end();

  const ok =
    writeFailed === 1 &&
    orders === 0 &&
    outbox === 0 &&
    published === 0 &&
    deliveries === 0 &&
    effect === 0;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:crash-write FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
