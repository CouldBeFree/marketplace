import { Queue, Worker, Job } from 'bullmq';
import { bullConnection } from './connection';

export const QUEUE_NAME = 'marketplace.jobs';

// Лічильники спостереження для демо (воркер і демо в одному процесі).
export interface JobStats {
  flakyAttempts: number; // скільки разів реально виконалась падуча задача
  scheduledRuns: number; // скільки разів спрацював планувальник
  completed: number; // скільки падучих задач успішно завершилось
}

export function makeQueue(): Queue {
  // Queue-з'єднання: падати швидко доречно (дефолтний ioredis).
  return new Queue(QUEUE_NAME, { connection: bullConnection() });
}

export function makeWorker(stats: JobStats): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === 'flaky') {
        // Падуча задача: валиться на перших двох спробах, успіх на третій → attempts=3.
        stats.flakyAttempts++;
        if (stats.flakyAttempts < 3) {
          throw new Error(`навмисний збій #${stats.flakyAttempts}`);
        }
        stats.completed++;
        return 'ok';
      }
      if (job.name === 'scheduled') {
        stats.scheduledRuns++;
        return 'tick';
      }
      return null;
    },
    {
      // ⚠️ Для ВОРКЕРА maxRetriesPerRequest:null — інакше ioredis на розриві кине виняток і
      // воркер зламається замість того, щоб дочекатися Redis.
      connection: { ...bullConnection(), maxRetriesPerRequest: null },
      concurrency: 1,
    },
  );
}
