import { Pool } from 'pg';
import { makePool, withRollback } from './testkit/db';
import { OrdersRepo } from '../../src/repositories/orders.repo';
import { aUser, aProduct, anOrder } from './testkit/builders';

// Репозиторій orders проти справжнього Postgres: FK-обмеження та SQL-агрегація —
// саме те, що in-memory мок не вміє перевірити.
describe('OrdersRepo (integration, testcontainers Postgres)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = makePool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('створює замовлення і додає позицію на наявний товар', async () => {
    await withRollback(pool, async (client) => {
      const repo = new OrdersRepo(client);
      const buyer = await aUser(client);
      const product = await aProduct(client);
      const order = await repo.create({
        buyerId: buyer.id,
        status: 'paid',
        shippingName: 'Buyer',
        totalCents: 2000,
      });
      await expect(
        repo.addItem({ orderId: order.id, productId: product.id, quantity: 2, unitPriceCents: 1000 }),
      ).resolves.toBeUndefined();
    });
  });

  it('FK order_items.product_id → products: неіснуючий товар дає код 23503', async () => {
    await withRollback(pool, async (client) => {
      const repo = new OrdersRepo(client);
      const order = await anOrder(client);
      await expect(
        repo.addItem({ orderId: order.id, productId: '999999999', quantity: 1, unitPriceCents: 500 }),
      ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
    });
  });

  it('revenueBySeller рахує виторг через JOIN + GROUP BY', async () => {
    await withRollback(pool, async (client) => {
      const repo = new OrdersRepo(client);
      const seller = await aUser(client);
      const product = await aProduct(client, { sellerId: seller.id, priceCents: 1000 });
      const order = await anOrder(client, { status: 'paid' });
      await repo.addItem({ orderId: order.id, productId: product.id, quantity: 3, unitPriceCents: 1000 });

      const rows = await repo.revenueBySeller();
      const mine = rows.find((r) => r.seller_id === seller.id);
      expect(mine).toBeDefined();
      expect(Number(mine!.revenue_cents)).toBe(3000); // 3 × 1000
    });
  });
});
