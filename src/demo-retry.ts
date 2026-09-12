import { pool } from './db';

// Retry-патерн. Два конкурентні read-modify-write під REPEATABLE READ на одному
// лічильнику → другий UPDATE дістає serialization failure (40001). Обгортка ловить
// ЛИШЕ 40001/40P01 і повторює ВСЮ транзакцію (з читаннями) з backoff. Без retry був
// би lost update (final = 1); з retry — арифметично коректний final = CONCURRENCY.
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

// read-modify-write: читаємо значення, рахуємо +1 у JS, пишемо — під REPEATABLE READ.
async function increment(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { rows } = await client.query('SELECT value FROM demo_counter WHERE id = 1');
    const current = Number(rows[0].value);
    await new Promise((r) => setTimeout(r, 25)); // гарантуємо перекриття снапшотів
    await client.query('UPDATE demo_counter SET value = $1 WHERE id = 1', [current + 1]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // назовні: withRetry вирішить, чи повторювати цілу транзакцію
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS demo_counter (id int PRIMARY KEY, value int NOT NULL)`,
  );
  await pool.query(
    `INSERT INTO demo_counter (id, value) VALUES (1, 0)
     ON CONFLICT (id) DO UPDATE SET value = 0`,
  );

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => withRetry(i + 1, () => increment())),
  );

  const { rows } = await pool.query('SELECT value FROM demo_counter WHERE id = 1');
  const final = Number(rows[0].value);

  console.log('');
  console.log(`конкурентних інкрементів:                 ${CONCURRENCY}`);
  console.log(`пійманих serialization failure (40001):   ${retries.length}`);
  console.log(`фінальне значення лічильника:             ${final} (очікуване ${CONCURRENCY})`);

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
