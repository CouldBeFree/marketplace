import { makeOrderPlaced, OrderPlaced } from '../events/order-placed';

export interface OrderRowForEvent {
  id: string;
  buyerId: string;
  productId: string;
  quantity: number;
  totalCents: number;
}

// Явний маппер «рядок БД → контракт події», а НЕ spread ORM-сутності. Інакше схема БД
// стає публічним API, і перше ж перейменування колонки ламає всіх консюмерів. Контракт
// (OrderPlaced) переживає рефактори таблиці; eventId — стабільний ключ ідемпотентності.
export function toOrderPlacedEvent(o: OrderRowForEvent): OrderPlaced {
  return makeOrderPlaced({
    orderId: String(o.id),
    buyerId: String(o.buyerId),
    productId: String(o.productId),
    quantity: o.quantity,
    totalCents: o.totalCents,
  });
}
