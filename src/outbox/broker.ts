import type { ChannelModel, Channel, ConfirmChannel } from 'amqplib';

// Виділена топологія ДЗ #22, окрема від shop.events із ДЗ #19 — щоб демо не перетиналися.
// Брокер тут — лише інструмент доставки (окремий від Postgres процес). Direct-exchange +
// durable classic-черга: для демонстрації outbox/ідемпотентності цього достатньо.
export const OUTBOX_EXCHANGE = 'outbox.events';
export const OUTBOX_QUEUE = 'q.outbox.order.placed';
export const OUTBOX_ROUTING_KEY = 'order.placed';

export async function assertOutboxTopology(conn: ChannelModel): Promise<Channel> {
  const ch = await conn.createChannel();
  await ch.assertExchange(OUTBOX_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(OUTBOX_QUEUE, { durable: true });
  await ch.bindQueue(OUTBOX_QUEUE, OUTBOX_EXCHANGE, OUTBOX_ROUTING_KEY);
  return ch;
}

// Чистий старт демо: черга існує (після assertTopology) — прибираємо залишки минулих прогонів.
export async function purgeOutboxQueue(ch: Channel): Promise<void> {
  await ch.purgeQueue(OUTBOX_QUEUE);
}

export interface OutboxPublisher {
  publish(payloadJson: string, messageId: string): Promise<void>;
  close(): Promise<void>;
}

// Confirm-канал: колбек publish = basic.ack брокера. «Опублікував» = брокер підтвердив прийом,
// а не «віддав у сокет». Саме тому помилка publish НЕ означає «не доставлено» (загубитись могла
// відповідь брокера) — через це дедуп на консюмері обовʼязковий незалежно від акуратності relay.
export async function createOutboxPublisher(conn: ChannelModel): Promise<OutboxPublisher> {
  const ch: ConfirmChannel = await conn.createConfirmChannel();
  await ch.assertExchange(OUTBOX_EXCHANGE, 'direct', { durable: true });

  const confirm = (body: Buffer, messageId: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      ch.publish(
        OUTBOX_EXCHANGE,
        OUTBOX_ROUTING_KEY,
        body,
        { contentType: 'application/json', persistent: true, messageId },
        (err) => (err ? reject(err) : resolve()),
      );
    });

  return {
    publish: (payloadJson, messageId) => confirm(Buffer.from(payloadJson), messageId),
    close: () => ch.close(),
  };
}
