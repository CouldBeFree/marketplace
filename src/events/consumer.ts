import type { Channel, ConsumeMessage } from 'amqplib';
import { QUEUE, PREFETCH } from './topology';
import { isOrderPlaced } from './order-placed';
import { applyEffectOnce } from './effect';

export interface ConsumerStats {
  delivered: number; // скільки доставок отримав консюмер
  effect: number; // скільки разів ефект фактично застосовано (дублі не рахуються)
  skipped: number; // доставки, де ефект пропущено як дубль (ON CONFLICT)
  acked: number; // підтверджено (після ефекту)
  rejected: number; // відкинуто в DLQ (невалідне тіло)
  requeued: number; // повернуто в чергу (імітація втраченого ack у demo:duplicate)
}

export interface ConsumerHandle {
  stats: ConsumerStats;
  stop(): Promise<void>;
}

export interface StartConsumerOpts {
  prefetch?: number;
  // demo:duplicate: рівно ОДИН раз на кожен eventId зробити nack(requeue=true) ПІСЛЯ ефекту,
  // щоб брокер повторив доставку. Це ОРКЕСТРАЦІЯ повтору (лічильник у памʼяті), а НЕ дедуп —
  // дедуп живе в Postgres (applyEffectOnce). На повторі ON CONFLICT відсіє → ack.
  requeueOnce?: boolean;
  // викликається після кожної доставки — демо так дізнається, коли можна завершувати
  onProgress?: (stats: ConsumerStats) => void;
}

export async function startConsumer(
  ch: Channel,
  opts: StartConsumerOpts = {},
): Promise<ConsumerHandle> {
  const prefetch = opts.prefetch ?? PREFETCH;
  const stats: ConsumerStats = {
    delivered: 0,
    effect: 0,
    skipped: 0,
    acked: 0,
    rejected: 0,
    requeued: 0,
  };
  const alreadyRequeued = new Set<string>(); // оркестрація повтору (не дедуп!)

  await ch.prefetch(prefetch); // БЕЗ цього (дефолт 0) один споживач загрібає всю чергу

  const onMessage = async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) return; // basic.cancel від брокера
    stats.delivered++;

    let event: unknown;
    try {
      event = JSON.parse(msg.content.toString());
    } catch {
      event = null;
    }

    // невалідне тіло → у DLQ (requeue=false → DLX), причина 'rejected'
    if (!isOrderPlaced(event)) {
      ch.reject(msg, false);
      stats.rejected++;
      opts.onProgress?.(stats);
      return;
    }

    // ЕФЕКТ — ПЕРЕД ack. ack означає «я більше не вимагаю повтору», не «дійшло».
    const { applied } = await applyEffectOnce(event.eventId, event.data.orderId);
    if (applied) stats.effect++;
    else stats.skipped++;

    // demo:duplicate: імітуємо падіння після ефекту, але до ack — ack «не доїхав»
    if (opts.requeueOnce && !alreadyRequeued.has(event.eventId)) {
      alreadyRequeued.add(event.eventId);
      ch.nack(msg, false, true); // requeue=true → брокер поверне → друга доставка
      stats.requeued++;
      opts.onProgress?.(stats);
      return;
    }

    ch.ack(msg);
    stats.acked++;
    opts.onProgress?.(stats);
  };

  const { consumerTag } = await ch.consume(QUEUE, onMessage, { noAck: false });

  return {
    stats,
    stop: async () => {
      await ch.cancel(consumerTag);
    },
  };
}
