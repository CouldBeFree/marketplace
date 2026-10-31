import type Redis from 'ioredis';
import { randomUUID } from 'crypto';

const LOCK_PREFIX = 'lock:';
const LOCK_TTL_MS = 5000; // лок живе коротко — рівно щоб переможець сходив у БД і прогрів кеш
const WAIT_TIMEOUT_MS = 3000;
const WAIT_INTERVAL_MS = 25;

// Lua compare-and-delete: знімаємо лок ТІЛЬКИ якщо його значення == наш токен. Голий DEL
// зняв би чужий лок — між «мій протух» і «я знімаю» вміщається чужий SET NX. Lua-CAD працює
// на будь-якій версії Redis (альтернатива — DELEX … IFEQ з 8.4, але compose у нас 7.x).
const COMPARE_AND_DELETE =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

// Single-flight: N одночасних промахів на один ключ дають ОДИН похід у БД. Переможець SET NX
// робить `work` (БД + прогрів кеша), решта чекає й перечитує кеш через `waitThenRead`.
//
// ⚠️ Це ОПТИМІЗАЦІЯ, не захист інваріанта: якщо лок зламається, буде кілька походів у базу
// (кілька центів), а не зіпсований стан. Від паузи, довшої за TTL лока, він не рятує — для
// цього потрібен fencing token; stampede-локу він не потрібен (див. README).
// Якщо переможець ПОМЕР, не прогрівши кеш, очікувач не повертає хибний null на наявний товар:
// він пробує стати новим переможцем, а на дедлайні читає сам (деградація до зайвих походів у БД,
// не до 404 на товар, що Є в базі).
export async function withSingleFlight<T>(
  redis: Redis,
  key: string,
  work: () => Promise<T>,
  waitThenRead: () => Promise<T | null>,
): Promise<T | null> {
  const lockKey = LOCK_PREFIX + key;
  const token = randomUUID();

  const acquired = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
  if (acquired === 'OK') {
    try {
      return await work();
    } finally {
      await redis.eval(COMPARE_AND_DELETE, 1, lockKey, token); // знімаємо ЛИШЕ свій лок
    }
  }

  // лок у когось іншого → чекаємо, поки переможець прогріє кеш, і перечитуємо
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const v = await waitThenRead();
    if (v !== null) return v; // переможець прогрів кеш — віддаємо з кеша
    if (Date.now() > deadline) break; // чекали достатньо — на fallback нижче
    // кеш порожній: переможець або ще працює, або ПОМЕР, не прогрівши кеш. Якщо лок зник —
    // пробуємо стати новим переможцем, щоб single-flight лишився в силі, а не щоб усі очікувачі
    // кинулись у БД одночасно.
    if ((await redis.exists(lockKey)) === 0) {
      const reacquired = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
      if (reacquired === 'OK') {
        try {
          return await work();
        } finally {
          await redis.eval(COMPARE_AND_DELETE, 1, lockKey, token);
        }
      }
      // не ми стали переможцем — хтось інший уже взяв лок; чекаємо далі
    }
    await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS));
  }
  // Дедлайн, а кеш так і порожній → переможець не прогрів його (помер/завис). КОРЕКТНІСТЬ >
  // єдиний похід: читаємо самі (БД + прогрів), щоб не повернути хибний null на товар, який Є в БД.
  return work();
}
