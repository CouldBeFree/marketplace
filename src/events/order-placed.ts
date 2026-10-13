import { randomUUID } from 'crypto';

// Подія домену Marketplace. Routing key == тип події.
export const ORDER_PLACED = 'order.placed';

// СВІДОМО спроектований контракт події — не ORM-сутність через spread.
// eventId — стабільний ключ, саме за ним споживач упізнає дубль (ідемпотентність).
export interface OrderPlaced {
  eventId: string;
  type: 'order.placed';
  occurredAt: string; // ISO-8601
  data: {
    orderId: string;
    buyerId: string;
    productId: string;
    quantity: number;
    totalCents: number;
  };
}

export function makeOrderPlaced(
  data: OrderPlaced['data'],
  eventId: string = randomUUID(),
): OrderPlaced {
  return { eventId, type: ORDER_PLACED, occurredAt: new Date().toISOString(), data };
}

// Мінімальна валідація вхідної події у споживача. Невалідне тіло (битий JSON чи
// відсутній контракт) → споживач зробить reject(requeue=false) → DLQ з причиною 'rejected'.
export function isOrderPlaced(x: unknown): x is OrderPlaced {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  const data = e.data as Record<string, unknown> | undefined;
  return (
    typeof e.eventId === 'string' &&
    e.eventId.length > 0 &&
    e.type === ORDER_PLACED &&
    !!data &&
    typeof data === 'object' &&
    typeof data.orderId === 'string'
  );
}
