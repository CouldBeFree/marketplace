import type Redis from 'ioredis';
import { pool } from '../db';
import { withSingleFlight } from './lock';

export interface ProductCard {
  id: string;
  title: string;
  priceCents: number;
  stock: number;
  sold: number;
}

const CACHE_PREFIX = 'cache:product:';
const BASE_TTL = 300; // 5 хв
const JITTER = 60; // +0..60с — розкид ≥10с

// Лічильник РЕАЛЬНИХ походів у БД — на рівні репозиторію (саме тут виконується SQL), а не
// «скільки разів викликали getProductCard». Це число і є весь сенс single-flight: під лавиною
// запитів на холодний ключ воно має лишитися 1.
let dbCalls = 0;
export function resetDbCalls(): void {
  dbCalls = 0;
}
export function getDbCalls(): number {
  return dbCalls;
}

// Свідомо ДОРОГЕ читання: картка товару = продукт + залишок + агрегат проданого
// (підзапит SUM по order_items). Саме таке читання варто кешувати.
async function readProductCardFromDb(productId: string): Promise<ProductCard | null> {
  dbCalls++;
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.price_cents, p.stock,
            COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0) AS sold
       FROM products p
      WHERE p.id = $1`,
    [productId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    title: r.title,
    priceCents: r.price_cents,
    stock: Number(r.stock),
    sold: Number(r.sold),
  };
}

// TTL ЗАВЖДИ з джитером: ключі, прогріті одним циклом, інакше протухнуть в одну секунду й
// дадуть stampede на порожньому місці. Повертаємо 300..360 — розкид 60с (≥10 за вимогою).
export function jitteredTtl(): number {
  return BASE_TTL + Math.floor(Math.random() * (JITTER + 1));
}

// Запис у кеш ЗАВЖДИ в try/catch: на дефолтному noeviction Redis кидає «OOM command not
// allowed…», і необгорнутий cacheSet впав би разом із запитом користувача. Промах кеша — не
// помилка застосунку: кеш, який роняє запити, це не кеш.
export async function cacheSet(
  redis: Redis,
  productId: string,
  value: ProductCard,
  ttlSec: number,
): Promise<void> {
  try {
    await redis.set(CACHE_PREFIX + productId, JSON.stringify(value), 'EX', ttlSec);
  } catch (err) {
    console.error('[cache] запис не вдався (ігноруємо):', (err as Error).message);
  }
}

// cache-aside + single-flight. Влучання → тільки Redis. Промах → один клієнт (переможець лока)
// іде в БД і прогріває кеш, решта чекає й перечитує.
export async function getProductCard(redis: Redis, productId: string): Promise<ProductCard | null> {
  const fullKey = CACHE_PREFIX + productId;

  const hit = await redis.get(fullKey);
  if (hit !== null) return JSON.parse(hit) as ProductCard;

  return withSingleFlight<ProductCard | null>(
    redis,
    productId,
    // переможець лока: ще раз перевіряємо кеш (хтось міг прогріти), потім БД + прогрів
    async () => {
      const again = await redis.get(fullKey);
      if (again !== null) return JSON.parse(again) as ProductCard;
      const card = await readProductCardFromDb(productId);
      if (card !== null) await cacheSet(redis, productId, card, jitteredTtl());
      return card;
    },
    // решта: просто перечитуємо кеш
    async () => {
      const v = await redis.get(fullKey);
      return v !== null ? (JSON.parse(v) as ProductCard) : null;
    },
  );
}

// Прогрів N ключів із РІЗНИМИ іменами й джитер-TTL. Повертає масив застосованих TTL (щоб
// демо порахувало ttl-distinct). Кожен прогрів бере свій простір імен — перезапис тих самих
// ключів пам'яті не додав би й витіснення не показав би.
export async function warmKeys(redis: Redis, prefix: string, count: number): Promise<number[]> {
  const ttls: number[] = [];
  const pipe = redis.pipeline();
  for (let i = 0; i < count; i++) {
    const ttl = jitteredTtl();
    ttls.push(ttl);
    pipe.set(`${CACHE_PREFIX}${prefix}:${i}`, JSON.stringify({ warm: i }), 'EX', ttl);
  }
  await pipe.exec();
  return ttls;
}
