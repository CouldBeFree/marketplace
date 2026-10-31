import type { JobsOptions } from 'bullmq';
import { makeQueueClient } from './connection';
import { makeQueue, makeWorker, JobStats } from './queue';
import { waitUntil } from '../events/wait';

// demo:queue ⭐ — черга ретраїть, дедуплікує і має планувальник.
// Дедуп: два add з тим самим jobId → одна задача в черзі. Ретрай: падуча задача з attempts=3
// виконується тричі (двічі падає, раз успіх). Планувальник: upsertJobScheduler every:500мс →
// ≥2 спрацювання за вікно. Очікуємо: completed=1 added=2 queued=1 queue-noeviction=1,
// attempts≥3 schedulers≥1 scheduled-runs≥2.
const JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 100, jitter: 0.5 },
  // ⚠️ НЕ removeOnComplete:true — це вимикає дедуп по jobId. Тримаємо з віком, більшим за
  // вікно можливого повтору, щоб дедуп лишився живим.
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 3600 },
};

async function main(): Promise<void> {
  // queue-noeviction: політика інстансу черги (BullMQ вимагає noeviction)
  const probe = makeQueueClient();
  const policy = ((await probe.config('GET', 'maxmemory-policy')) as string[])[1];
  const queueNoeviction = policy === 'noeviction' ? 1 : 0;

  const queue = makeQueue();
  await queue.obliterate({ force: true }); // self-clean

  // 1. ДЕДУП — два add з тим самим jobId (без воркера): у черзі лишається одна задача
  await queue.add('task', { n: 1 }, { jobId: 'dedup-1', ...JOB_OPTS });
  await queue.add('task', { n: 2 }, { jobId: 'dedup-1', ...JOB_OPTS }); // дубль → ігнор
  const added = 2;
  const queued = await queue.getWaitingCount();
  const dj = await queue.getJob('dedup-1');
  if (dj) await dj.remove(); // приберемо дедуп-задачу перед запуском воркера

  // 2. РЕТРАЙ — падуча задача + воркер
  const stats: JobStats = { flakyAttempts: 0, scheduledRuns: 0, completed: 0 };
  const worker = makeWorker(stats);
  await worker.waitUntilReady();
  await queue.add('flaky', {}, JOB_OPTS);
  await waitUntil(() => stats.completed >= 1, {
    timeoutMs: 15000,
    label: 'падуча задача завершилась після ретраїв',
  });

  // 3. ПЛАНУВАЛЬНИК — upsertJobScheduler (repeatable-API у BullMQ 6 прибрано; upsert, не add,
  // інакше кожен рестарт плодив би дублікати планувальників)
  await queue.upsertJobScheduler('sched-1', { every: 500 }, { name: 'scheduled', data: {} });
  const schedulers = (await queue.getJobSchedulers()).length;
  await waitUntil(() => stats.scheduledRuns >= 2, {
    timeoutMs: 15000,
    label: 'планувальник спрацював ≥2 рази',
  });
  const scheduledRuns = stats.scheduledRuns;

  console.log(`queue-noeviction=${queueNoeviction}`);
  console.log(`attempts=${stats.flakyAttempts}`);
  console.log(`completed=${stats.completed}`);
  console.log(`added=${added}`);
  console.log(`queued=${queued}`);
  console.log(`schedulers=${schedulers}`);
  console.log(`scheduled-runs=${scheduledRuns}`);

  // cleanup
  await queue.removeJobScheduler('sched-1');
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await probe.quit();

  const ok =
    stats.completed === 1 &&
    added === 2 &&
    queued === 1 &&
    queueNoeviction === 1 &&
    stats.flakyAttempts >= 3 &&
    schedulers >= 1 &&
    scheduledRuns >= 2;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:queue FAILED:', err);
  process.exit(1);
});
