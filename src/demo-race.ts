import { pool } from './db';
import { checkout } from './checkout';

// Конкурентне навантаження на один товар: ATTEMPTS паралельних checkout по 1 одиниці,
// stock = INITIAL_STOCK. Обмежувати має саме stock (баланс надлишковий), тож успішних
// має бути рівно INITIAL_STOCK, фінальний stock = 0, відʼємних рядків = 0.
const ATTEMPTS = 50;
const INITIAL_STOCK = 10;

async function main(): Promise<void> {
  // ── фікстур: цільовий товар зі stock=10, покупець із надлишковим балансом ──
  const { rows: prod } = await pool.query(`SELECT id FROM products ORDER BY id LIMIT 1`);
  const { rows: buyer } = await pool.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
  const productId: string = prod[0].id;
  const buyerId: string = buyer[0].id;
  await pool.query(`UPDATE products SET stock = $2 WHERE id = $1`, [productId, INITIAL_STOCK]);
  await pool.query(`UPDATE users SET balance_cents = 100000000 WHERE id = $1`, [buyerId]);

  // ── ATTEMPTS паралельних checkout, без черг у застосунку ──
  const results = await Promise.all(
    Array.from({ length: ATTEMPTS }, () =>
      checkout({ buyerId, productId, quantity: 1 }),
    ),
  );
  const success = results.filter((r) => r.ok).length;

  const { rows: s } = await pool.query(`SELECT stock FROM products WHERE id = $1`, [productId]);
  const finalStock = Number(s[0].stock);
  const { rows: n } = await pool.query(`SELECT count(*)::int AS neg FROM products WHERE stock < 0`);
  const negative = n[0].neg;

  console.log(`спроб:                       ${ATTEMPTS}`);
  console.log(`успішних:                    ${success}`);
  console.log(`фінальний stock:             ${finalStock}`);
  console.log(`рядків із відʼємним stock:   ${negative}`);

  const invariantOk =
    success === INITIAL_STOCK && finalStock === 0 && negative === 0;
  console.log(
    invariantOk
      ? 'OK: рівно stock успішних, без oversell'
      : 'ПОРУШЕНО: стався oversell!',
  );

  await pool.end();
  process.exit(invariantOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error('demo:race FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
