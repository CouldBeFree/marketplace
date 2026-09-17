import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { OrderItem } from './entities/order-item.entity';

// Звітний запит, який неможливо виразити через find(): агрегат + GROUP BY + JOIN.
// «Виторг по продавцях»: сума (ціна_позиції × кількість) по товарах продавця,
// не рахуючи скасованих замовлень. Реалізація — QueryBuilder + getRawMany().
async function main(): Promise<void> {
  await AppDataSource.initialize();

  const rows = await AppDataSource.getRepository(OrderItem)
    .createQueryBuilder('oi')
    .innerJoin('oi.product', 'p')
    .innerJoin('p.seller', 's')
    .innerJoin('oi.order', 'o')
    .where('o.status <> :cancelled', { cancelled: 'cancelled' })
    .select('s.id', 'seller_id')
    .addSelect('s.fullName', 'seller_name')
    .addSelect('COUNT(DISTINCT o.id)', 'orders')
    .addSelect('SUM(oi.quantity)', 'units')
    .addSelect('SUM(oi.unitPriceCents * oi.quantity)', 'revenue_cents')
    .groupBy('s.id')
    .addGroupBy('s.fullName')
    .orderBy('revenue_cents', 'DESC')
    .getRawMany();

  // SUM(bigint) приходить РЯДКОМ (bigint у number може не влізти), тож друкуємо як є.
  // revenue_cents — у мінорних одиницях (копійки).
  console.log('Виторг по продавцях, копійки (без скасованих замовлень):');
  console.log('─'.repeat(64));
  console.log(
    'seller_id'.padEnd(10) +
      'seller_name'.padEnd(20) +
      'orders'.padEnd(9) +
      'units'.padEnd(8) +
      'revenue_cents',
  );
  console.log('─'.repeat(64));
  for (const r of rows) {
    console.log(
      String(r.seller_id).padEnd(10) +
        String(r.seller_name).padEnd(20) +
        String(r.orders).padEnd(9) +
        String(r.units).padEnd(8) +
        String(r.revenue_cents),
    );
  }
  console.log('─'.repeat(64));

  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error('report FAILED:', err);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
