import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// URI тестового контейнера: з env (успадкований воркером) або з файла global-setup.
export function testDbUrl(): string {
  const fromEnv = process.env.TEST_DATABASE_URL;
  if (fromEnv) return fromEnv;
  return fs.readFileSync(path.join(__dirname, '.db-url'), 'utf8').trim();
}

export function makePool(): Pool {
  return new Pool({ connectionString: testDbUrl() });
}

// Ізоляція ROLLBACK: кожен тест виконується в транзакції, яку ЗАВЖДИ відкочуємо —
// дані не лишаються, тож повторний запуск suite поспіль зелений без ручної чистки.
export async function withRollback<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
