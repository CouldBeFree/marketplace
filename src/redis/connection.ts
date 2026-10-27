import Redis from 'ioredis';

// Адреси Redis — ВИКЛЮЧНО з оточення (REDIS_URL / REDIS_QUEUE_URL), яке локально наповнює
// scripts/with-secrets.sh зі сховища ДЗ #11, а грейдер — через export + SKIP_VAULT=1.
// Два РІЗНІ інстанси: кеш (allkeys-lru) і черга+сесії+ліміт (noeviction) — несумісні політики.
export function cacheUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL не задано. Локально запускай через `npm run demo:cache` (значення зі сховища ' +
        'ДЗ #11). Грейдеру: `export REDIS_URL=redis://127.0.0.1:6391` + `export SKIP_VAULT=1`.',
    );
  }
  return url;
}

export function queueUrl(): string {
  const url = process.env.REDIS_QUEUE_URL;
  if (!url) {
    throw new Error(
      'REDIS_QUEUE_URL не задано. Локально — через `npm run demo:session|ratelimit|queue`. ' +
        'Грейдеру: `export REDIS_QUEUE_URL=redis://127.0.0.1:6392` + `export SKIP_VAULT=1`.',
    );
  }
  return url;
}

// Клієнт кеш-інстансу. Звичайні команди — дефолтний ioredis (ретраї на розриві доречні).
export function makeCacheClient(): Redis {
  return new Redis(cacheUrl());
}

// Клієнт черги/сесій/ліміту (noeviction-інстанс).
export function makeQueueClient(): Redis {
  return new Redis(queueUrl());
}

// Параметри підключення для BullMQ (Queue/Worker/Scheduler). host/port із queueUrl.
// Для ВОРКЕРА треба maxRetriesPerRequest:null — інакше ioredis на розриві кине виняток і
// воркер зламається, замість того щоб дочекатися Redis. Для Queue, навпаки, падати швидко — ок.
export function bullConnection(): { host: string; port: number } {
  const u = new URL(queueUrl());
  return { host: u.hostname, port: Number(u.port || 6379) };
}
