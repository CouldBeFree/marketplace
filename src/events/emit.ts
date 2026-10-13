import { OrderPlaced, makeOrderPlaced } from './order-placed';

// Продюсер нічого не знає про транспорт, поки його не під'єднають у бутстрапі/демо.
// setOrderPublisher викликають ОДИН раз при старті (там, де є з'єднання з брокером).
// demo:race та інтеграційні тести publisher НЕ під'єднують → emitOrderPlaced = no-op,
// тож критична транзакція checkout лишається незалежною від брокера (подію просто нікуди слати).
type OrderPublisher = { publish(event: OrderPlaced): Promise<void> };

let current: OrderPublisher | null = null;

export function setOrderPublisher(publisher: OrderPublisher | null): void {
  current = publisher;
}

// Викликається з checkout ПІСЛЯ COMMIT: подія виходить саме з критичної бізнес-операції.
export async function emitOrderPlaced(data: OrderPlaced['data']): Promise<void> {
  if (!current) return;
  await current.publish(makeOrderPlaced(data));
}
