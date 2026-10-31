import { pool } from '../db';
import { makeCacheClient } from './connection';
import { getProductCard, warmKeys, resetDbCalls, getDbCalls } from './cache';
import { ensureFixtures } from '../outbox/schema';

// demo:cache ⭐ — кеш економить походи в базу, а лавина дає рівно один.
// Прогріваємо ≥50 ключів із джитер-TTL (ttl-distinct десятки, не 1), потім кидаємо ≥20
// одночасних запитів на ХОЛОДНИЙ ключ: single-flight лок дає db-calls=1. Теплий кеш → 0.
// Очікуємо: cache-lru=1 cache-maxmemory=1 warmed≥50 ttl-distinct≥5 concurrent≥20
//           db-calls=1 db-calls-warm=0.
const CONCURRENT = 30;
const WARM_COUNT = 60;
const WARM_READS = 100;

async function main(): Promise<void> {
  const redis = makeCacheClient();

  // 1. політики кеш-інстансу — читаємо В РАНТАЙМІ з кеш-з'єднання
  const policy = ((await redis.config('GET', 'maxmemory-policy')) as string[])[1];
  const maxmem = ((await redis.config('GET', 'maxmemory')) as string[])[1];
  const cacheLru = policy !== 'noeviction' ? 1 : 0; // allkeys-lru → 1
  const cacheMaxmemory = Number(maxmem) > 0 ? 1 : 0;

  // 2. фікстура: реальний товар у БД (для дорогого читання картки)
  const { productId } = await ensureFixtures();

  // 3. самоочищення кеш-інстансу
  await redis.flushdb();

  // 4. прогрів ≥50 ключів із джитер-TTL (кожен прогрів — свій простір імен)
  const ttls = await warmKeys(redis, `warm-${Date.now()}`, WARM_COUNT);
  const warmed = ttls.length;
  const ttlDistinct = new Set(ttls).size;

  // 5. ЛАВИНА на холодний ключ: CONCURRENT одночасних → рівно 1 похід у БД (single-flight)
  resetDbCalls();
  await Promise.all(Array.from({ length: CONCURRENT }, () => getProductCard(redis, productId)));
  const dbCallsCold = getDbCalls();

  // 6. теплий кеш: WARM_READS читань того ж ключа → 0 походів у БД
  resetDbCalls();
  for (let i = 0; i < WARM_READS; i++) await getProductCard(redis, productId);
  const dbCallsWarm = getDbCalls();

  console.log(`cache-lru=${cacheLru}`);
  console.log(`cache-maxmemory=${cacheMaxmemory}`);
  console.log(`warmed=${warmed}`);
  console.log(`ttl-distinct=${ttlDistinct}`);
  console.log(`concurrent=${CONCURRENT}`);
  console.log(`db-calls=${dbCallsCold}`);
  console.log(`db-calls-warm=${dbCallsWarm}`);

  await redis.quit();
  await pool.end();

  const ok =
    dbCallsCold === 1 &&
    dbCallsWarm === 0 &&
    cacheLru === 1 &&
    cacheMaxmemory === 1 &&
    CONCURRENT >= 20 &&
    warmed >= 50 &&
    ttlDistinct >= 5;
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:cache FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
