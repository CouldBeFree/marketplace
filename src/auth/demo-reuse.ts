import { bootApp, cleanAndSeed, makeClient, poolOf, printAndExit, DemoUser } from './demo-util';

// demo:reuse ⭐ — СЕРЦЕ ДЗ. Повторне використання refresh валить УСЮ сімʼю.
//  r1-refresh=200: чесна ротація (R0 → R1).
//  r1-reuse=401: повторне предʼявлення R0 (уже використаного) — сигнал компрометації.
//  r2-after-reuse=401: і R1 (на руках у чесного клієнта) теж мертвий — бо детекція відкликала
//  всю сімʼю. Саме це відрізняє ротацію ВІД ротації з детекцією: r1-reuse=401 вміє й ротація
//  без сімʼї, а r2-after-reuse=401 — ні (RFC 9700 §4.14.2).
//  Очікуємо: login=200 r1-refresh=200 r1-reuse=401 r2-after-reuse=401.
const PORT = 3102;
const USER: DemoUser = { email: 'buyer-reuse@auth.local', password: 'buyer-reuse-pw', role: 'buyer' };

async function main(): Promise<void> {
  const app = await bootApp(PORT);
  await cleanAndSeed(poolOf(app), [USER]);
  const http = makeClient(PORT);
  const r: Record<string, number> = {};

  try {
    const login = await http('POST', '/auth/login', {
      body: { email: USER.email, password: USER.password },
    });
    r['login'] = login.status;
    const r0 = (login.json as { refresh: string }).refresh;

    const rot = await http('POST', '/auth/refresh', { body: { refresh: r0 } });
    r['r1-refresh'] = rot.status; // чесна ротація: R0 → R1
    const r1 = (rot.json as { refresh?: string }).refresh ?? '';

    // ПОВТОР уже використаного R0 → детекція компрометації → відкликання всієї сімʼї
    r['r1-reuse'] = (await http('POST', '/auth/refresh', { body: { refresh: r0 } })).status;

    // чесний клієнт зі «своїм» R1 теж вилітає — сімʼю вже вбито
    r['r2-after-reuse'] = (await http('POST', '/auth/refresh', { body: { refresh: r1 } })).status;
  } finally {
    await app.close();
  }

  const ok =
    r['login'] === 200 &&
    r['r1-refresh'] === 200 &&
    r['r1-reuse'] === 401 &&
    r['r2-after-reuse'] === 401;
  printAndExit(r, ok);
}

main().catch((err) => {
  console.error('demo:reuse FAILED:', err);
  process.exit(1);
});
