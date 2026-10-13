import type { ChannelModel, Channel } from 'amqplib';
import { ORDER_PLACED } from './order-placed';

// ── Імена топології (єдине джерело правди для продюсера, споживача й демо) ──────
export const EXCHANGE = 'shop.events'; // topic-exchange подій домену
export const QUEUE = 'q.order.placed'; // робоча черга під order.placed
export const ROUTING_KEY = ORDER_PLACED; // 'order.placed'

// DLQ як ОКРЕМИЙ контур: мертві листи з робочої черги їдуть у DLX, звідти — в DLQ.
export const DLX = 'shop.events.dlx'; // dead-letter exchange (fanout)
export const DLQ = 'q.order.placed.dlq';

// prefetch: скільки непідтверджених доставок споживач тримає «в руках» одночасно.
// Обґрунтування (формула prefetch × час_обробки < consumer_timeout): ефект тут — один
// маленький INSERT (~одиниці мс), consumer_timeout стоковий = 30 хв. 10 × ~5 мс = ~50 мс
// ≪ 30 хв: конвеєр заповнений, таймаут недосяжний. Для важких задач (секунди) ставили б 1.
export const PREFETCH = 10;

// Оголошує топологію СПОЖИВАЧ/бутстрап, НЕ продюсер: продюсер не знає, хто його слухає.
// Routing key без відповідного binding — порожній звук (повідомлення зникає, а confirm
// при цьому позитивний), тому binding робимо саме тут.
//
// Робоча черга — quorum ('x-queue-type':'quorum'): durable за визначенням, підтримує
// delivery-limit. 'x-dead-letter-exchange' скеровує відкинуті листи у DLX → DLQ.
export async function assertTopology(conn: ChannelModel): Promise<Channel> {
  const ch = await conn.createChannel();

  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });

  await ch.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': DLX,
    },
  });
  await ch.assertQueue(DLQ, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });

  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await ch.bindQueue(DLQ, DLX, ''); // fanout ігнорує ключ — ловить усі мертві листи

  return ch;
}

// Чистий старт демо: черги існують (після assertTopology), прибираємо залишки з минулих
// прогонів. Ідемпотентність ефекту додатково гарантують свіжі eventId у кожному прогоні.
export async function purgeAll(ch: Channel): Promise<void> {
  await ch.purgeQueue(QUEUE);
  await ch.purgeQueue(DLQ);
}
