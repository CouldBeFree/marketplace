import type Redis from 'ioredis';

// Сесії/токен-стан — у Redis, НЕ в пам'яті процесу: після рестарту процесу сесія має жити.
// Інстанс — noeviction (не кеш!): allkeys-lru колись викинув би сесію й дав розлогінення,
// яке ніхто не може відтворити. Сесія — хеш; rolling TTL продовжуємо на кожному доступі.
const SESSION_PREFIX = 'session:';

export type SessionData = Record<string, string>;

export async function createSession(
  redis: Redis,
  sessionId: string,
  data: SessionData,
  ttlSec: number,
): Promise<void> {
  const key = SESSION_PREFIX + sessionId;
  const flat: string[] = [];
  for (const [k, v] of Object.entries(data)) flat.push(k, String(v));
  await redis.hset(key, ...flat);
  await redis.expire(key, ttlSec);
}

// Прочитати сесію й ПРОДОВЖИТИ TTL (rolling): активний користувач не має вилетіти посеред
// роботи. Читаємо хеш і одразу оновлюємо TTL ключа (аналог EXPIRE/GETEX для цілого хеша).
export async function touchSession(
  redis: Redis,
  sessionId: string,
  ttlSec: number,
): Promise<SessionData | null> {
  const key = SESSION_PREFIX + sessionId;
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  await redis.expire(key, ttlSec); // rolling TTL при активності
  return data as SessionData;
}

export async function sessionTtlMs(redis: Redis, sessionId: string): Promise<number> {
  return redis.pttl(SESSION_PREFIX + sessionId);
}

export async function sessionExists(redis: Redis, sessionId: string): Promise<boolean> {
  return (await redis.exists(SESSION_PREFIX + sessionId)) === 1;
}

export async function deleteSession(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(SESSION_PREFIX + sessionId);
}
