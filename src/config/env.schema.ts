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
