import { pool } from './db';

// Воркер-пул через SKIP LOCKED: WORKERS воркерів (Promise-и на окремих клієнтах пулу)
// розбирають чергу tasks. Кожну задачу обробляє рівно один воркер (processed = 1),
// подвійної обробки немає, а сумарний час менший за послідовний (N × TASK_MS).
const N_TASKS = 40;
const WORKERS = 3;
const TASK_MS = 15; // симуляція роботи над задачею (лист/чек)

async function seedTasks(): Promise<void> {
  // детермінований старт: чиста черга + N pending-задач на існуюче замовлення
  await pool.query(`DELETE FROM tasks`);
  const { rows } = await pool.query(`SELECT id FROM orders ORDER BY id LIMIT 1`);
  const orderId: string = rows[0].id;
  await pool.query(
    `INSERT INTO tasks (order_id, kind, status)
     SELECT $1, 'email', 'pending' FROM generate_series(1, $2)`,
    [orderId, N_TASKS],
  );
}

async function worker(name: string, counts: Record<string, number>): Promise<void> {
  const client = await pool.connect();
  try {
    for (;;) {
      await client.query('BEGIN');
      // беремо одну вільну задачу; SKIP LOCKED пропускає ті, що вже тримає інший воркер
      const { rows } = await client.query(
        `SELECT id FROM tasks WHERE status = 'pending'
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );

      if (rows.length === 0) {
        await client.query('COMMIT');
        // порожній SKIP LOCKED = «вільних немає ЗАРАЗ», не «черга порожня».
        // Перепитуємо: якщо pending узагалі не лишилось — виходимо; інакше локи
        // ще тримають інші воркери, трохи чекаємо й пробуємо знову.
        const { rows: pend } = await client.query(
          `SELECT count(*)::int AS c FROM tasks WHERE status = 'pending'`,
        );
        if (pend[0].c === 0) break;
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }

      const taskId: string = rows[0].id;
      // лок тримається на час обробки: впав воркер до COMMIT — задачу підбере інший
      await new Promise((r) => setTimeout(r, TASK_MS));
      await client.query(
        `UPDATE tasks
         SET status = 'done', processed = processed + 1, locked_by = $2
         WHERE id = $1`,
        [taskId, name],
      );
      await client.query('COMMIT'); // статус done + результат комітяться разом
      counts[name] = (counts[name] ?? 0) + 1;
    }
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await seedTasks();

  const counts: Record<string, number> = {};
  const start = Date.now();
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => worker(`w${i + 1}`, counts)),
  );
  const elapsed = Date.now() - start;

  const { rows: d } = await pool.query(
    `SELECT count(*)::int AS c FROM tasks WHERE processed > 1`,
  );
  const doubled = d[0].c;
  const { rows: done } = await pool.query(
    `SELECT count(*)::int AS c FROM tasks WHERE status = 'done'`,
  );
  const doneCount = done[0].c;
  const sequential = N_TASKS * TASK_MS;

  console.log(`задач: ${N_TASKS}, воркерів: ${WORKERS}`);
  console.log(`розподіл по воркерах:`, counts);
  console.log(`оброблено двічі: ${doubled}`);
  console.log(`оброблено (done): ${doneCount}`);
  console.log(`час: ${elapsed} мс (послідовно було б ~${sequential} мс)`);

  const ok = doubled === 0 && doneCount === N_TASKS && elapsed < sequential;
  console.log(
    ok
      ? 'OK: кожна задача рівно раз, паралельно й швидше за послідовне'
      : 'ПОРУШЕНО',
  );

  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:workers FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
