import {
  bootApp,
  cleanAndSeed,
  makeClient,
  poolOf,
  forgeTampered,
  printAndExit,
  DemoUser,
} from './demo-util';

// demo:rbac — 401 ≠ 403, власність, роль і що підпис СПРАВДІ перевіряється.
//  anon=401 (нема токена) vs foreign=403 (валідний токен, чуже) — це і є розділення двох
//  дисциплін: автентифікація проти авторизації. role-denied=403 (покупець) vs role-allowed=201
//  (продавець) — RBAC рівня ролі. tampered=401 — підмінений payload зі старим підписом;
//  рішення на jwt.decode() віддало б тут 201, а не 401.
//  Очікуємо: anon=401 own=200 foreign=403 role-denied=403 role-allowed=200|201 tampered=401.
const PORT = 3103;
const BUYER: DemoUser = { email: 'buyer-rbac@auth.local', password: 'buyer-rbac-pw', role: 'buyer' };
const BUYER2: DemoUser = { email: 'buyer2-rbac@auth.local', password: 'buyer2-rbac-pw', role: 'buyer' };
const SELLER: DemoUser = { email: 'seller-rbac@auth.local', password: 'seller-rbac-pw', role: 'seller' };

async function login(http: ReturnType<typeof makeClient>, u: DemoUser): Promise<string> {
  const res = await http('POST', '/auth/login', { body: { email: u.email, password: u.password } });
  return (res.json as { access: string }).access;
}

async function main(): Promise<void> {
  const app = await bootApp(PORT);
  await cleanAndSeed(poolOf(app), [BUYER, BUYER2, SELLER]);
  const http = makeClient(PORT);
  const r: Record<string, number> = {};

  try {
    const buyer = await login(http, BUYER);
    const buyer2 = await login(http, BUYER2);
    const seller = await login(http, SELLER);

    // замовлення, власник якого — buyer (власність = особа з токена, не заголовок)
    const created = await http('POST', '/orders', {
      token: buyer,
      headers: { 'Idempotency-Key': `rbac-${Date.now()}` },
      body: { items: [{ product_id: 'prod_1', quantity: 1 }] },
    });
    const orderId = (created.json as { id: string }).id;

    r['anon'] = (await http('GET', `/orders/${orderId}`)).status; // нема токена → 401
    r['own'] = (await http('GET', `/orders/${orderId}`, { token: buyer })).status; // власник → 200
    r['foreign'] = (await http('GET', `/orders/${orderId}`, { token: buyer2 })).status; // чуже → 403

    const product = { name: 'Demo Product', price_cents: 1234, currency: 'UAH' };
    r['role-denied'] = (await http('POST', '/products', { token: buyer, body: product })).status; // 403
    r['role-allowed'] = (await http('POST', '/products', { token: seller, body: product })).status; // 201

    r['tampered'] = (
      await http('GET', `/orders/${orderId}`, { token: forgeTampered(buyer) })
    ).status; // підмінений payload, старий підпис → 401
  } finally {
    await app.close();
  }

  const ok =
    r['anon'] === 401 &&
    r['own'] === 200 &&
    r['foreign'] === 403 &&
    r['role-denied'] === 403 &&
    (r['role-allowed'] === 200 || r['role-allowed'] === 201) &&
    r['tampered'] === 401;
  printAndExit(r, ok);
}

main().catch((err) => {
  console.error('demo:rbac FAILED:', err);
  process.exit(1);
});
