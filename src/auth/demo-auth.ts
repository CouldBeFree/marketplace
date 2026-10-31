import { bootApp, cleanAndSeed, makeClient, poolOf, printAndExit, DemoUser } from './demo-util';

// demo:auth — логін, доступ і логаут, що прибиває ОБИДВА токени.
//  after-logout=401 (денилист убив self-contained access) + refresh-after-logout=401 (сімʼю
//  refresh відкликано). Це ДВА різні докази: access живе до exp без денилиста; refresh — рядок
//  у БД, його досить позначити. Очікуємо: login=200 no-token=401 with-token=200 refresh=200
//  logout=200|204 after-logout=401 refresh-after-logout=401.
const PORT = 3101;
const USER: DemoUser = { email: 'buyer-auth@auth.local', password: 'buyer-auth-pw', role: 'buyer' };

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
    const { access, refresh } = (login.json ?? {}) as { access: string; refresh: string };

    r['no-token'] = (await http('GET', '/auth/me')).status;
    r['with-token'] = (await http('GET', '/auth/me', { token: access })).status;

    const refreshed = await http('POST', '/auth/refresh', { body: { refresh } });
    r['refresh'] = refreshed.status;
    const pair2 = (refreshed.json ?? {}) as { access: string; refresh: string };

    r['logout'] = (await http('POST', '/auth/logout', { token: pair2.access })).status;
    r['after-logout'] = (await http('GET', '/auth/me', { token: pair2.access })).status;
    r['refresh-after-logout'] = (
      await http('POST', '/auth/refresh', { body: { refresh: pair2.refresh } })
    ).status;
  } finally {
    await app.close();
  }

  const ok =
    r['login'] === 200 &&
    r['no-token'] === 401 &&
    r['with-token'] === 200 &&
    r['refresh'] === 200 &&
    (r['logout'] === 200 || r['logout'] === 204) &&
    r['after-logout'] === 401 &&
    r['refresh-after-logout'] === 401;
  printAndExit(r, ok);
}

main().catch((err) => {
  console.error('demo:auth FAILED:', err);
  process.exit(1);
});
