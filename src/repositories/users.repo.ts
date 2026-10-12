import { Pool, PoolClient } from 'pg';

// Репозиторій приймає «щось із query()» — Pool або PoolClient. Саме тому тести
// можуть підключити стратегію ізоляції ROLLBACK: передати клієнта в транзакції.
export type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface NewUser {
  email: string;
  fullName: string;
  balanceCents?: number;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  balance_cents: number;
  created_at: Date;
}

export class UsersRepo {
  constructor(private readonly db: Queryable) {}

  async create(u: NewUser): Promise<UserRow> {
    // balance_cents не передаємо, якщо не задано → спрацьовує DB-DEFAULT 0
    if (u.balanceCents === undefined) {
      const { rows } = await this.db.query(
        `INSERT INTO users (email, full_name) VALUES ($1, $2)
         RETURNING id, email, full_name, balance_cents, created_at`,
        [u.email, u.fullName],
      );
      return rows[0];
    }
    const { rows } = await this.db.query(
      `INSERT INTO users (email, full_name, balance_cents) VALUES ($1, $2, $3)
       RETURNING id, email, full_name, balance_cents, created_at`,
      [u.email, u.fullName, u.balanceCents],
    );
    return rows[0];
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query(
      `SELECT id, email, full_name, balance_cents, created_at FROM users WHERE email = $1`,
      [email],
    );
    return rows[0] ?? null;
  }
}
