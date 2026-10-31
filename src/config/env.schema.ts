import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  DB_URL: z
    .string({ required_error: 'DB_URL is required' })
    .url('DB_URL must be a valid postgres:// connection string'),

  DB_PASSWORD_FILE: z.string().min(1).default('secrets/db_password'),

  // Рядок підключення до брокера подій RabbitMQ (ДЗ #19), напр. amqp://app:app@host:5672.
  // ОПЦІЙНА: HTTP-застосунок і тести без неї стартують; демо подій
  // (demo:publish/dlq/duplicate) fail-fast, якщо її нема. Значення — зі сховища ДЗ #11
  // (локально, через with-secrets) або від грейдера (export BROKER_URL + SKIP_VAULT=1).
  BROKER_URL: z
    .string()
    .url('BROKER_URL must be a valid amqp:// connection string')
    .optional(),

  // Redis під КЕШ (ДЗ #23), напр. redis://host:6391 (інстанс allkeys-lru + maxmemory).
  // ОПЦІЙНА: застосунок/тести без неї стартують; demo:cache fail-fast без неї.
  REDIS_URL: z
    .string()
    .url('REDIS_URL must be a valid redis:// connection string')
    .optional(),

  // Redis під ЧЕРГУ + сесії + rate-limit (ДЗ #23), напр. redis://host:6392 (noeviction).
  // ОПЦІЙНА: demo:session/ratelimit/queue fail-fast без неї. ДЗ #24 кладе сюди ж денилист
  // access-токенів (noeviction — денилист не можна витісняти, інакше токен «воскресне»).
  REDIS_QUEUE_URL: z
    .string()
    .url('REDIS_QUEUE_URL must be a valid redis:// connection string')
    .optional(),

  // ── ДЗ #24: Auth ────────────────────────────────────────────────────────────
  // Ключі підпису access-JWT (ES256) приходять ЗІ СХОВИЩА ДЗ #11, base64 від PEM
  // (багаторядковий PEM в export виживає не скрізь → кладемо base64). ОБОВʼЯЗКОВІ й БЕЗ
  // дефолтів: дефолт тут = зашитий у код ключ, тобто можливість підробити будь-який токен.
  // Без них голий `npm run start` падає на валідації (до БД) і називає змінну (критерій 3).
  JWT_PRIVATE_KEY: z
    .string({ required_error: 'JWT_PRIVATE_KEY is required (base64 EC P-256 PKCS8 PEM зі сховища)' })
    .min(1, 'JWT_PRIVATE_KEY must not be empty'),

  JWT_PUBLIC_KEY: z
    .string({ required_error: 'JWT_PUBLIC_KEY is required (base64 EC P-256 SPKI PEM зі сховища)' })
    .min(1, 'JWT_PUBLIC_KEY must not be empty'),

  // kid у JWT-заголовку → який ключ перевіряти (overlap-ротація: під час ротації приймаємо
  // і старий, і новий kid). Назва ключа, не секрет; обовʼязкова (без неї не знаємо, чим верифікувати).
  JWT_KID: z
    .string({ required_error: 'JWT_KID is required' })
    .min(1, 'JWT_KID must not be empty'),

  // «Перець» для HMAC-хеша refresh-токена: у БД лежить HMAC(pepper, token), а не токен і не
  // голий SHA-256 — дамп таблиці стає марним навіть при витоку бази. Зі сховища, без дефолту.
  REFRESH_TOKEN_PEPPER: z
    .string({ required_error: 'REFRESH_TOKEN_PEPPER is required (зі сховища)' })
    .min(16, 'REFRESH_TOKEN_PEPPER must be at least 16 chars'),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `❌ Невалідна конфігурація середовища (${parsed.error.issues.length}):\n${details}`,
    );
  }

  return parsed.data;
}
