import { Pool } from 'pg';
import { makePool, withRollback } from './testkit/db';
import { UsersRepo } from '../../src/repositories/users.repo';
import { aUser, uniqueEmail } from './testkit/builders';

// Репозиторій users проти справжнього Postgres (testcontainers). Кожен тест — у
// транзакції-відкаті (ізоляція ROLLBACK), тож прогони поспіль лишаються зеленими.
describe('UsersRepo (integration, testcontainers Postgres)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = makePool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('створює користувача і знаходить його за email', async () => {
    await withRollback(pool, async (client) => {
      const email = uniqueEmail();
      const repo = new UsersRepo(client);
      const created = await repo.create({ email, fullName: 'Alice' });
      expect(created.id).toBeDefined();

      const found = await repo.findByEmail(email);
      expect(found?.email).toBe(email);
      expect(found?.full_name).toBe('Alice');
    });
  });

  it('порушення UNIQUE(email) дає duplicate key / код 23505', async () => {
    await withRollback(pool, async (client) => {
      const email = uniqueEmail();
      const repo = new UsersRepo(client);
      await repo.create({ email, fullName: 'First' });
      await expect(repo.create({ email, fullName: 'Second' })).rejects.toMatchObject({
        code: '23505', // unique_violation — те, чого мок не має
      });
    });
  });

  it('DB проставляє дефолти: balance_cents = 0 і created_at', async () => {
    await withRollback(pool, async (client) => {
      const u = await aUser(client); // без balanceCents → спрацьовує DEFAULT 0
      expect(Number(u.balance_cents)).toBe(0);
      expect(u.created_at).toBeInstanceOf(Date);
    });
  });
});
