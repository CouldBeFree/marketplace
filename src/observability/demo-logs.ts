import { startOtel, shutdownOtel } from './otel';
import { traceparent, request, parseJson, captureStream } from './demo-util';

// demo:logs — корелятор живе в КОНТЕКСТІ, а не в аргументах: 8 паралельних запитів не змішуються,
// найглибший шар має той самий trace_id, trace_id = trace-id активного спана (== заголовок),
// секрети редагуються. Очікуємо: non-json-lines=0 layers≥3 distinct-trace-ids=1
// trace-id-matches-header=1 burst=8 burst-trace-ids=8 burst-uneven=0 secret-req-logged=1 secret-in-logs=0.

async function main(): Promise<void> {
  // OTel — ПЕРШОЮ дією (щоб trace_id у логах був із активного спана), застосунок — динамічно ПІСЛЯ.
  startOtel({ inMemory: true });
  const { createLogger } = await import('./logger');
  const { makeApp } = await import('./app');

  const lines: string[] = [];
  const logger = createLogger({ stream: captureStream(lines) });
  const app = await makeApp(logger);
  const port = app.port;
  const r: Record<string, number> = {};

  // ── Фаза 1: один запит через 3 шари з відомим traceparent ──
  let mark = lines.length;
  const tp1 = traceparent();
  await request(port, 'POST', '/orders/abc', { headers: { traceparent: tp1.header, 'x-user-id': 'u1' } });
  const single = lines.slice(mark).map(parseJson).filter((x): x is Record<string, unknown> => !!x);
  const singleTraceIds = new Set(single.map((l) => l.trace_id).filter(Boolean));
  r['layers'] = new Set(single.map((l) => l.layer).filter(Boolean)).size;
  r['distinct-trace-ids'] = singleTraceIds.size;
  r['trace-id-matches-header'] = singleTraceIds.size === 1 && singleTraceIds.has(tp1.traceId) ? 1 : 0;

  // ── Фаза 2: сплеск — 8 паралельних, кожен зі своїм traceparent ──
  mark = lines.length;
  const N = 8;
  const tps = Array.from({ length: N }, () => traceparent());
  await Promise.all(
    tps.map((tp) => request(port, 'POST', '/orders/x', { headers: { traceparent: tp.header } })),
  );
  const burst = lines
    .slice(mark)
    .map(parseJson)
    .filter((x): x is Record<string, unknown> => !!x && !!x.trace_id);
  const groups = new Map<unknown, number>();
  for (const l of burst) groups.set(l.trace_id, (groups.get(l.trace_id) ?? 0) + 1);
  const sizes = [...groups.values()];
  r['burst'] = N;
  r['burst-trace-ids'] = groups.size;
  r['burst-uneven'] = sizes.length > 0 && sizes.every((s) => s === sizes[0]) ? 0 : 1;

  // ── Фаза 3: секрети (Authorization + password) — рядок запиту є, маркерів немає ──
  mark = lines.length;
  const m1 = 'SEKRETAUTH' + Math.random().toString(36).slice(2);
  const m2 = 'SEKRETPASS' + Math.random().toString(36).slice(2);
  await request(port, 'POST', '/auth/login', {
    headers: { authorization: `Bearer ${m1}` },
    body: { password: m2 },
  });
  const secret = lines.slice(mark);
  r['secret-req-logged'] = secret.some((s) => s.includes('auth request')) ? 1 : 0;
  r['secret-in-logs'] = secret.some((s) => s.includes(m1) || s.includes(m2)) ? 1 : 0;

  // non-json-lines — по ВСІХ зібраних рядках
  r['non-json-lines'] = lines.filter((s) => parseJson(s) === null).length;

  await app.close();
  await shutdownOtel();

  for (const [k, v] of Object.entries(r)) console.log(`${k}=${v}`);
  const ok =
    r['non-json-lines'] === 0 &&
    r['layers'] >= 3 &&
    r['distinct-trace-ids'] === 1 &&
    r['trace-id-matches-header'] === 1 &&
    r['burst'] >= 8 &&
    r['burst-trace-ids'] === r['burst'] &&
    r['burst-uneven'] === 0 &&
    r['secret-req-logged'] === 1 &&
    r['secret-in-logs'] === 0;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:logs FAILED:', err);
  process.exit(1);
});
