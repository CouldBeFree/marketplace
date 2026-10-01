import { Queryable, UsersRepo, UserRow } from '../../../src/repositories/users.repo';
import { OrdersRepo } from '../../../src/repositories/orders.repo';

// Унікальні дефолти, щоб тести не містили «стіни фікстур» і не падали на UNIQUE.
let seq = 0;
export const uniqueEmail = (): string => `user_${Date.now()}_${seq++}@test.local`;

export async function aUser(db: Queryable, over: Partial<{ email: string; fullName: string; balanceCents: number }> = {}): Promise<UserRow> {
  return new UsersRepo(db).create({
    email: over.email ?? uniqueEmail(),
    fullName: over.fullName ?? 'Test User',
    balanceCents: over.balanceCents,
  });
}

export interface ProductRow {
  id: string;
  seller_id: string;
  price_cents: number;
}

export async function aProduct(
  db: Queryable,
  over: Partial<{ sellerId: string; title: string; priceCents: number }> = {},
): Promise<ProductRow> {
  const sellerId = over.sellerId ?? (await aUser(db)).id;
  const { rows } = await db.query(
    `INSERT INTO products (seller_id, title, price_cents) VALUES ($1, $2, $3)
     RETURNING id, seller_id, price_cents`,
    [sellerId, over.title ?? `Product ${seq++}`, over.priceCents ?? 1000],
  );
  return rows[0];
}

export async function anOrder(
  db: Queryable,
  over: Partial<{ buyerId: string; status: string; shippingName: string; totalCents: number }> = {},
): Promise<{ id: string }> {
  const buyerId = over.buyerId ?? (await aUser(db)).id;
  return new OrdersRepo(db).create({
    buyerId,
    status: over.status ?? 'paid',
    shippingName: over.shippingName ?? 'Test Buyer',
    totalCents: over.totalCents ?? 0,
  });
}
