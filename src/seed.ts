import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// Детермінований і ІДЕМПОТЕНТНИЙ seed. id — GENERATED ALWAYS, тож явні id не
// задаємо; ідемпотентність тримаємо на природних ключах:
//   users   → email (UNIQUE)
//   products→ (seller_id, title)
//   orders  → shipping_name = 'SEED-ORDER-<n>' (унікальний у межах seed)
// Другий запуск нічого не дублює й не падає.

const USERS = [
  { email: 'alice@shop.local', fullName: 'Alice Seller' },
  { email: 'bob@shop.local', fullName: 'Bob Seller' },
  { email: 'carol@shop.local', fullName: 'Carol Buyer' },
  { email: 'dave@shop.local', fullName: 'Dave Buyer' },
  { email: 'erin@shop.local', fullName: 'Erin Buyer' },
  { email: 'frank@shop.local', fullName: 'Frank Buyer' },
];

// price_cents — integer у мінорних одиницях (копійки)
const PRODUCTS = [
  { sellerEmail: 'alice@shop.local', title: 'Keyboard', priceCents: 4999 },
  { sellerEmail: 'alice@shop.local', title: 'Mouse', priceCents: 1950 },
  { sellerEmail: 'alice@shop.local', title: 'Monitor', priceCents: 19900 },
  { sellerEmail: 'alice@shop.local', title: 'Desk', priceCents: 14900 },
  { sellerEmail: 'bob@shop.local', title: 'Laptop Stand', priceCents: 3999 },
  { sellerEmail: 'bob@shop.local', title: 'USB-C Hub', priceCents: 2999 },
  { sellerEmail: 'bob@shop.local', title: 'Webcam', priceCents: 5900 },
  { sellerEmail: 'bob@shop.local', title: 'Headset', priceCents: 8990 },
];

const BUYERS = ['carol@shop.local', 'dave@shop.local', 'erin@shop.local', 'frank@shop.local'];
const STATUSES = ['completed', 'pending', 'paid', 'shipped', 'completed', 'cancelled'];
const ORDER_COUNT = 12;

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const userRepo = AppDataSource.getRepository(User);
  const productRepo = AppDataSource.getRepository(Product);
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);

  // ── users (find-or-create за email) ──
  const usersByEmail = new Map<string, User>();
  for (const u of USERS) {
    let row = await userRepo.findOne({ where: { email: u.email } });
    if (!row) row = await userRepo.save(userRepo.create(u));
    usersByEmail.set(u.email, row);
  }

  // ── products (find-or-create за seller_id + title) ──
  const products: Product[] = [];
  for (const p of PRODUCTS) {
    const seller = usersByEmail.get(p.sellerEmail)!;
    let row = await productRepo.findOne({
      where: { sellerId: seller.id, title: p.title },
    });
    if (!row) {
      row = await productRepo.save(
        productRepo.create({ title: p.title, priceCents: p.priceCents, seller }),
      );
    }
    products.push(row);
  }

  // ── orders + items (find-or-create за shipping_name) ──
  for (let n = 1; n <= ORDER_COUNT; n++) {
    const shippingName = `SEED-ORDER-${n}`;
    const existing = await orderRepo.findOne({ where: { shippingName } });
    if (existing) continue; // вже засіяно — не дублюємо

    const buyer = usersByEmail.get(BUYERS[n % BUYERS.length])!;
    const status = STATUSES[n % STATUSES.length];

    // детермінований набір позицій: 1..3 товари, кількість залежить від n
    const picks: Array<{ product: Product; quantity: number }> = [];
    const lineCount = 1 + (n % 3); // 1, 2 або 3 позиції
    for (let i = 0; i < lineCount; i++) {
      const product = products[(n + i) % products.length];
      picks.push({ product, quantity: 1 + ((n + i) % 3) });
    }

    // total у копійках — ЦІЛЕ додавання, без float-арифметики
    const totalCents = picks.reduce(
      (sum, { product, quantity }) => sum + product.priceCents * quantity,
      0,
    );

    const order = await orderRepo.save(
      orderRepo.create({ buyer, status, shippingName, totalCents }),
    );

    for (const { product, quantity } of picks) {
      await itemRepo.save(
        itemRepo.create({ order, product, quantity, unitPriceCents: product.priceCents }),
      );
    }
  }

  // ── звіт про стан ──
  const counts = {
    users: await userRepo.count(),
    products: await productRepo.count(),
    orders: await orderRepo.count(),
    order_items: await itemRepo.count(),
  };
  console.log('seed OK:', JSON.stringify(counts));

  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error('seed FAILED:', err);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
