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
