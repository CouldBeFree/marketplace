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
    .addSelect('SUM(oi.unitPrice * oi.quantity)', 'revenue')
    .groupBy('s.id')
    .addGroupBy('s.fullName')
    .orderBy('revenue', 'DESC')
    .getRawMany();

  // Агрегати приходять РЯДКАМИ (numeric/bigint), тож друкуємо як є, не кастуючи в number.
  console.log('Виторг по продавцях (без скасованих замовлень):');
  console.log('─'.repeat(64));
  console.log(
    'seller_id'.padEnd(10) +
      'seller_name'.padEnd(20) +
      'orders'.padEnd(9) +
      'units'.padEnd(8) +
      'revenue',
  );
  console.log('─'.repeat(64));
  for (const r of rows) {
    console.log(
      String(r.seller_id).padEnd(10) +
        String(r.seller_name).padEnd(20) +
        String(r.orders).padEnd(9) +
        String(r.units).padEnd(8) +
        String(r.revenue),
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
