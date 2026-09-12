import { Pool } from 'pg';

// Спільний pg-пул для демо-скриптів конкурентності. Рядок підключення — суто з
// оточення (process.env.DB_URL), який наповнює scripts/with-secrets.sh зі сховища
// ДЗ #11 (або грейдер через SKIP_VAULT=1). Жодних зашитих креденшелів.
//
// max за замовчуванням 50 — demo:race робить 50 паралельних викликів, кожен тримає
// власного клієнта на час транзакції; за потреби можна звузити через PG_POOL_MAX.
export const pool = new Pool({
  connectionString: process.env.DB_URL,
  max: Number(process.env.PG_POOL_MAX ?? 50),
});
