import { randomUUID } from 'crypto';
import { makeQueueClient } from './connection';
import {
  createSession,
  touchSession,
  sessionTtlMs,
  sessionExists,
  deleteSession,
} from './session';

// demo:session — сесія живе в Redis (noeviction-інстанс) і ПОДОВЖУЄТЬСЯ при активності.
// Між запитами реально чекаємо, щоб TTL встиг зменшитись, інакше ttl-renewed був би 0 навіть
// на правильному rolling-у. Очікуємо: sessions=1 in-redis=1 ttl-renewed=1, requests≥3.
const TTL = 10; // сек — короткий, щоб подовження було видно очима
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const redis = makeQueueClient();
  const sessionId = randomUUID();
  await deleteSession(redis, sessionId); // self-clean

  const seen = new Set<string>();
  let requests = 0;

  // req #1 — створення сесії
  await createSession(redis, sessionId, { userId: 'user-42', role: 'buyer' }, TTL);
  seen.add(sessionId);
  requests++;

  // req #2 — активність ПІСЛЯ паузи: TTL спав, rolling має повернути його вгору
  await sleep(2000);
  const ttlBefore = await sessionTtlMs(redis, sessionId);
  await touchSession(redis, sessionId, TTL); // читає сесію + продовжує TTL
  seen.add(sessionId);
  requests++;
  const ttlAfter = await sessionTtlMs(redis, sessionId);

  // req #3 — ще одна активність
  await sleep(1000);
  await touchSession(redis, sessionId, TTL);
  seen.add(sessionId);
  requests++;

  const sessions = seen.size;
  const inRedis = (await sessionExists(redis, sessionId)) ? 1 : 0;
  const ttlRenewed = ttlAfter > ttlBefore ? 1 : 0;

  console.log(`requests=${requests}`);
  console.log(`sessions=${sessions}`);
  console.log(`in-redis=${inRedis}`);
  console.log(`ttl-renewed=${ttlRenewed}`);

  await deleteSession(redis, sessionId);
  await redis.quit();

  const ok = requests >= 3 && sessions === 1 && inRedis === 1 && ttlRenewed === 1;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:session FAILED:', err);
  process.exit(1);
});
