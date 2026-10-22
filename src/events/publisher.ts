import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { EXCHANGE, ROUTING_KEY } from './topology';
import { OrderPlaced } from './order-placed';

export interface Publisher {
  publish(event: OrderPlaced): Promise<void>;
  // нижчий рівень — для demo:dlq (свідомо биле тіло, яке споживач відкине в DLQ)
  publishRaw(body: Buffer, messageId?: string): Promise<void>;
  close(): Promise<void>;
}

// Confirm-канал: createConfirmChannel + waitForConfirms. Без цього «опублікував» означає
// лише «віддав у сокет» — брокер міг і не прийняти. waitForConfirms чекає basic.ack від
// брокера на КОЖНУ публікацію, тож ми справді знаємо, що подія прийнята (або впаде помилка).
export async function createPublisher(conn: ChannelModel): Promise<Publisher> {
  const ch: ConfirmChannel = await conn.createConfirmChannel();
  // продюсер лише переконується, що exchange існує; черги/binding — турбота споживача
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  const confirmPublish = (body: Buffer, messageId?: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      ch.publish(
        EXCHANGE,
        ROUTING_KEY,
        body,
        { contentType: 'application/json', persistent: true, messageId },
        (err) => (err ? reject(err) : resolve()), // колбек confirm-каналу = basic.ack брокера
      );
    });

  return {
    publish: (event) =>
      confirmPublish(Buffer.from(JSON.stringify(event)), event.eventId),
    publishRaw: (body, messageId) => confirmPublish(body, messageId),
    close: () => ch.close(),
  };
}
