import 'reflect-metadata';
import { DataSource, Logger, QueryRunner } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// N+1 не видно в коді — лише в лозі SQL. Найпростіший лічильник: власний Logger,
// що інкрементить count на кожен logQuery (кожен logQuery = один рейс у БД).
class QueryCountLogger implements Logger {
  public count = 0;
  reset(): void {
    this.count = 0;
  }
  logQuery(_query: string, _params?: unknown[], _qr?: QueryRunner): void {
    this.count += 1;
  }
  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DB_URL,
    synchronize: false,
    entities: [User, Product, Order, OrderItem],
    logging: ['query'],
    logger,
  });
  await ds.initialize();

  const orderRepo = ds.getRepository(Order);
  const itemRepo = ds.getRepository(OrderItem);
  const productRepo = ds.getRepository(Product);

  // ── ДО: наївно — запит на кожен рівень у циклі (класичний N+1) ──
  logger.reset();
  const orders = await orderRepo.find(); // 1 запит
  for (const o of orders) {
    const items = await itemRepo.find({ where: { orderId: o.id } }); // +N
    for (const it of items) {
      await productRepo.findOne({ where: { id: it.productId } }); // +M
    }
  }
  const naive = logger.count;
  const n = orders.length;

  // ── ПІСЛЯ (1): relations — стратегія 'join' за замовчуванням → 1 запит ──
  logger.reset();
  await orderRepo.find({ relations: { items: { product: true } } });
  const joinAll = logger.count;

  // ── ПІСЛЯ (2): relationLoadStrategy 'query' → 1 + 2×рівнів, теж константа ──
  logger.reset();
  await orderRepo.find({
    relations: { items: { product: true } },
    relationLoadStrategy: 'query',
  });
  const queryStrategy = logger.count;

  // ── незалежність від N: та сама join-стратегія на меншій вибірці → те саме число ──
  logger.reset();
  const firstBuyer = orders[0]?.buyerId;
  const subset = await orderRepo.find({
    where: { buyerId: firstBuyer },
    relations: { items: { product: true } },
  });
  const joinSubset = logger.count;

  console.log('─'.repeat(60));
  console.log(`Граф: order → items → product (2 рівні зв'язків)`);
  console.log(`Вибірка: N = ${n} замовлень`);
  console.log('─'.repeat(60));
  console.log(`ДО   (наївно, запит у циклі):        ${naive} запитів   (= 1 + N + позиції, росте з N)`);
  console.log(`ПІСЛЯ (relations / join):             ${joinAll} запит(и)   (константа, не залежить від N)`);
  console.log(`ПІСЛЯ (relationLoadStrategy 'query'): ${queryStrategy} запит(и)   (≤ 1 + 2×2 = 5)`);
  console.log('─'.repeat(60));
  console.log(`Незалежність від N: join на ${subset.length} замовл. (менша вибірка) = ${joinSubset} запит(и) — те саме число.`);
  console.log('─'.repeat(60));

  await ds.destroy();
}

main().catch(async (err) => {
  console.error('demo:nplus1 FAILED:', err);
  process.exit(1);
});
