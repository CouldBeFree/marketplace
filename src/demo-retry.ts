import { pool } from './db';

// Retry-патерн. Два конкурентні read-modify-write під REPEATABLE READ на одному
// лічильнику → другий UPDATE дістає serialization failure (40001). Обгортка ловить
// ЛИШЕ 40001/40P01 і повторює ВСЮ транзакцію (з читаннями) з backoff. Без retry був
// би lost update (final = 1); з retry — арифметично коректний final = CONCURRENCY.
//
// Лічильник — це `stock` реального товару (не ad-hoc таблиця): скрипт нічого не
// створює в схемі й нічого не лишає по собі; усі таблиці — лише з міграцій.
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 50;

const retries: Array<{ worker: number; attempt: number; code: string }> = [];

async function withRetry<T>(worker: number, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // 40001 = serialization_failure, 40P01 = deadlock_detected — лише їх повторюємо
      if (code === '40001' || code === '40P01') {
        retries.push({ worker, attempt, code });
        console.log(`retry worker ${worker}: спроба ${attempt}, код ${code} → повтор транзакції`);
        await new Promise((r) => setTimeout(r, attempt * 5 + Math.random() * 5)); // backoff
        continue;
      }
      throw err; // будь-яка інша помилка — не наша, кидаємо далі
    }
  }
  throw new Error(`worker ${worker}: вичерпано ${MAX_ATTEMPTS} спроб`);
}

// read-modify-write: читаємо stock, рахуємо +1 у JS, пишемо — під REPEATABLE READ.
async function increment(productId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { rows } = await client.query('SELECT stock FROM products WHERE id = $1', [productId]);
    const current = Number(rows[0].stock);
    await new Promise((r) => setTimeout(r, 25)); // гарантуємо перекриття снапшотів
    await client.query('UPDATE products SET stock = $2 WHERE id = $1', [productId, current + 1]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {}); // не маскувати початкову помилку
    throw err; // назовні: withRetry вирішить, чи повторювати цілу транзакцію
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  // лічильник — stock першого товару; скидаємо до 0 (демо повторюване)
  const { rows: p } = await pool.query('SELECT id FROM products ORDER BY id LIMIT 1');
  const productId: string = p[0].id;
  await pool.query('UPDATE products SET stock = 0 WHERE id = $1', [productId]);

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      withRetry(i + 1, () => increment(productId)),
    ),
  );

  const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
  const final = Number(rows[0].stock);

  console.log('');
  console.log(`конкурентних інкрементів:                 ${CONCURRENCY}`);
  console.log(`пійманих serialization failure (40001):   ${retries.length}`);
  console.log(`фінальне значення лічильника (stock):     ${final} (очікуване ${CONCURRENCY})`);

  const ok = final === CONCURRENCY && retries.length >= 1;
  console.log(
    ok
      ? 'OK: retry врятував від lost update, арифметика сходиться'
      : 'ПОРУШЕНО: або не було serialization failure, або значення не зійшлось',
  );

  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:retry FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
