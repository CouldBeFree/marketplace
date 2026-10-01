// Headless-демо ізоляції WS-кімнат.
//
//   node scripts/realtime-demo.mjs              → клієнти в РІЗНИХ кімнатах: B не чує подію A
//   node scripts/realtime-demo.mjs --same-room  → обидва в кімнаті A: B МУСИТЬ почути
//
// Обидва режими йдуть ТИМ САМИМ кодом — очікуване B_RECEIVED береться з того ж прапорця,
// тож скрипт, який друкував би константу, провалить контрольний прогін.
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const USER = 'demo-user';
const sameRoom = process.argv.includes('--same-room');

async function createOrder(key) {
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      'X-User-Id': USER,
    },
    body: JSON.stringify({ items: [{ product_id: 'prod_1', quantity: 1 }] }),
  });
  if (!res.ok) throw new Error(`create order failed: ${res.status}`);
  return (await res.json()).id;
}

const connect = () => io(BASE, { auth: { userId: USER }, transports: ['websocket'] });
const onConnect = (sock) => new Promise((r) => sock.on('connect', r));
const join = (sock, orderId) =>
  new Promise((resolve, reject) => {
    sock.emit('join', { orderId }, (ack) =>
      ack?.ok ? resolve(ack) : reject(new Error(ack?.error ?? 'join failed')),
    );
  });

async function main() {
  const orderA = await createOrder(`demo-a-${Date.now()}`);
  const orderB = await createOrder(`demo-b-${Date.now()}`);
  const roomB = sameRoom ? orderA : orderB; // ← один рядок вирішує режим
  const expectedB = sameRoom ? 1 : 0; // ← очікування звідти ж

  const clientA = connect();
  const clientB = connect();
  let aReceived = 0;
  let bReceived = 0;
  clientA.on('order.status', (e) => {
    if (e.orderId === orderA) aReceived = 1;
  });
  clientB.on('order.status', (e) => {
    if (e.orderId === orderA) bReceived = 1;
  });

  // спершу connect, потім join і ЧЕКАЄМО ack — інакше подія вилетить раніше, ніж клієнт у кімнаті
  await Promise.all([onConnect(clientA), onConnect(clientB)]);
  await join(clientA, orderA);
  await join(clientB, roomB);

  // міняємо статус A через HTTP → emit у кімнату orders:<A>
  await fetch(`${BASE}/orders/${orderA}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paid' }),
  });

  await new Promise((r) => setTimeout(r, 500)); // даємо подіям долетіти

  clientA.close();
  clientB.close();

  console.log(`A_RECEIVED=${aReceived}`);
  console.log(`B_RECEIVED=${bReceived}`);

  const ok = aReceived === 1 && bReceived === expectedB;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo failed:', err.message);
  process.exit(1);
});
