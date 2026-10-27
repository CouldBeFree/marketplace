import type Redis from 'ioredis';

// Ковзне вікно ОДНИМ атомарним Lua-скриптом (а не трьома командами ZREMRANGEBYSCORE/ZCARD/
// ZADD): інакше між перевіркою і вставкою влізає інший под, і ліміт протікає рівно під
// навантаженням. Тут атомарність — ВИМОГА КОРЕКТНОСТІ (на відміну від лока в кеші, де вона
// була оптимізацією). Модель — ковзне вікно: жодного сплеску на межі (фіксоване пропускало б
// до 2× ліміту на стику вікон).
//
// KEYS[1] — ключ вікна (спільний на всі поди). ARGV: now(ms), window(ms), limit, member.
// Повертає {allowed(1/0), remaining, retryAfterMs}.
const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = window
if oldest[2] then retry = (tonumber(oldest[2]) + window) - now end
if retry < 0 then retry = 0 end
return {0, 0, retry}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number; // для заголовка Retry-After (секунди)
}

// Лічильник живе в Redis, а не в пам'яті процесу: два поди сервісу ділять ОДИН ліміт.
// (in-memory лічильник чи дефолтне сховище @nestjs/throttler множили б ліміт на к-сть подів.)
export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async check(member: string): Promise<RateLimitResult> {
    const now = Date.now();
    const [allowed, remaining, retryMs] = (await this.redis.eval(
      SLIDING_WINDOW,
      1,
      this.key,
      String(now),
      String(this.windowMs),
      String(this.limit),
      member,
    )) as [number, number, number];
    return {
      allowed: allowed === 1,
      remaining,
      retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  }
}
