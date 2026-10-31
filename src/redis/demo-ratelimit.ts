import { fork } from 'child_process';
import { makeQueueClient } from './connection';
import { RateLimiter } from './ratelimit';

// demo:ratelimit — ліміт СПІЛЬНИЙ на два поди. Тепер «поди» — це два РЕАЛЬНІ дочірні процеси
// (child_process.fork), кожен зі своїм з'єднанням до спільного Redis і спільним ключем вікна.
// Атомарний Lua-ліміт пропускає рівно `limit` СУМАРНО між процесами, решту — 429 + Retry-After.
// На in-memory лічильнику два поди пропустили б 2×limit. Батько форкає обидва, чекає, поки обидва
// під'єднаються, і стартує їх синхронно, щоб усі запити влучили в одне вікно.
// Очікуємо: instances=2 allowed==limit blocked≥1 status=429 retry-after=1.
const LIMIT = 5;
const WINDOW_MS = 1000; // 1с: Retry-After завжди округлюється до 1
const INSTANCES = 2;
const PER_INSTANCE = 6; // 2×6 = 12 запитів сумарно
const REQUESTS = INSTANCES * PER_INSTANCE;

interface GoMsg {
  type: 'go';
  key: string;
  limit: number;
  windowMs: number;
  count: number;
}
interface DoneMsg {
  type: 'done';
  allowed: number;
  blocked: number;
  status: number;
  retryAfter: number;
}

// ---- дочірній процес («под»): свій клієнт, свій лімітер, спільний ключ ----
async function child(): Promise<void> {
  const redis = makeQueueClient();
  process.send?.({ type: 'ready' });

  process.on('message', async (msg: GoMsg) => {
    if (msg.type !== 'go') return;
    const limiter = new RateLimiter(redis, msg.key, msg.limit, msg.windowMs);
    let allowed = 0;
    let blocked = 0;
    let status = 0;
    let retryAfter = 0;
    for (let i = 0; i < msg.count; i++) {
      const res = await limiter.check(`${process.pid}-${i}`); // унікальний member на процес
      if (res.allowed) {
        allowed++;
      } else {
        blocked++;
        status = 429;
        retryAfter = res.retryAfterSec;
      }
    }
    await redis.quit();
    const done: DoneMsg = { type: 'done', allowed, blocked, status, retryAfter };
    process.send?.(done, () => process.exit(0));
  });
}

// ---- батько: форкає 2 поди, стартує обидва синхронно, збирає підсумок ----
async function parent(): Promise<void> {
  const key = `ratelimit:demo:${Date.now()}`; // свіже вікно щопрогону (self-clean)
  const kids = Array.from({ length: INSTANCES }, () => fork(__filename, ['child']));

  let readyCount = 0;
  let doneCount = 0;
  let allowed = 0;
  let blocked = 0;
  let lastStatus = 0;
  let lastRetryAfter = 0;

  const finished = new Promise<void>((resolve) => {
    for (const kid of kids) {
      kid.on('message', (msg: { type: string } & Partial<Omit<DoneMsg, 'type'>>) => {
        if (msg.type === 'ready') {
          readyCount++;
          if (readyCount === INSTANCES) {
            // обидва поди під'єднані → даємо старт синхронно, щоб запити влучили в одне вікно
            const go: GoMsg = {
              type: 'go',
              key,
              limit: LIMIT,
              windowMs: WINDOW_MS,
              count: PER_INSTANCE,
            };
            for (const k of kids) k.send(go);
          }
        } else if (msg.type === 'done') {
          allowed += msg.allowed ?? 0;
          blocked += msg.blocked ?? 0;
          if (msg.status === 429) {
            lastStatus = 429;
            lastRetryAfter = msg.retryAfter ?? 0;
          }
          doneCount++;
          if (doneCount === INSTANCES) resolve();
        }
      });
    }
  });

  const guard = setTimeout(() => {
    console.error('demo:ratelimit FAILED: поди не відзвітували вчасно');
    process.exit(1);
  }, 15000);

  await finished;
  clearTimeout(guard);

  console.log(`instances=${INSTANCES}`);
  console.log(`limit=${LIMIT}`);
  console.log(`requests=${REQUESTS}`);
  console.log(`allowed=${allowed}`);
  console.log(`blocked=${blocked}`);
  console.log(`status=${lastStatus}`);
  console.log(`retry-after=${lastRetryAfter}`);

  const cleanup = makeQueueClient();
  await cleanup.del(key); // прибираємо вікно
  await cleanup.quit();

  const ok =
    lastStatus === 429 &&
    lastRetryAfter === 1 &&
    INSTANCES >= 2 &&
    LIMIT > 0 &&
    allowed === LIMIT &&
    blocked >= 1;
  process.exit(ok ? 0 : 1);
}

const run = process.argv[2] === 'child' ? child : parent;
run().catch((err) => {
  console.error('demo:ratelimit FAILED:', err);
  process.exit(1);
});
