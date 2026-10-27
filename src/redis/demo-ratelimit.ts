import { makeQueueClient } from './connection';
import { RateLimiter } from './ratelimit';

// demo:ratelimit — ліміт СПІЛЬНИЙ на два поди. Піднімаємо два незалежні екземпляри лімітера
// (різні з'єднання), що ділять ОДИН ключ у спільному Redis. Сумарно вони пропускають рівно
// limit, решту — 429 + Retry-After. На in-memory лічильнику два поди пропустили б 2×limit.
// Очікуємо: instances≥2 allowed==limit blocked≥1 status=429 retry-after=1.
const LIMIT = 5;
const WINDOW_MS = 1000; // 1с: Retry-After завжди округлюється до 1
const INSTANCES = 2;
const REQUESTS = 12;

async function main(): Promise<void> {
  const clients = Array.from({ length: INSTANCES }, () => makeQueueClient());
  const key = `ratelimit:demo:${Date.now()}`; // свіже вікно щопрогону (self-clean)
  const limiters = clients.map((c) => new RateLimiter(c, key, LIMIT, WINDOW_MS));

  let allowed = 0;
  let blocked = 0;
  let lastStatus = 0;
  let lastRetryAfter = 0;

  for (let i = 0; i < REQUESTS; i++) {
    const limiter = limiters[i % INSTANCES]; // по черзі між «подами»
    const res = await limiter.check(`req-${i}`);
    if (res.allowed) {
      allowed++;
    } else {
      blocked++;
      lastStatus = 429;
      lastRetryAfter = res.retryAfterSec;
    }
  }

  console.log(`instances=${INSTANCES}`);
  console.log(`limit=${LIMIT}`);
  console.log(`requests=${REQUESTS}`);
  console.log(`allowed=${allowed}`);
  console.log(`blocked=${blocked}`);
  console.log(`status=${lastStatus}`);
  console.log(`retry-after=${lastRetryAfter}`);

  await clients[0].del(key); // прибираємо вікно
  for (const c of clients) await c.quit();

  const ok =
    lastStatus === 429 &&
    lastRetryAfter === 1 &&
    INSTANCES >= 2 &&
    LIMIT > 0 &&
    allowed === LIMIT &&
    blocked >= 1;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:ratelimit FAILED:', err);
  process.exit(1);
});
