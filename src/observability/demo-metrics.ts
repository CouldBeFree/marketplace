import { startOtel, shutdownOtel } from './otel';
import { traceparent, request, captureStream } from './demo-util';

// demo:metrics — RED рахує те, що СТАЛОСЯ, а множина значень лейбла обмежена. Числа — з ДВОХ
// скрейпів /metrics (не друкуються). Очікуємо: sent-ok+sent-fail≥50 counter-delta=sent
// errors-delta=sent-fail above-top-bucket=0 series-after=series-before.

const ROUTE = '/orders/:id';

interface Sample {
  labels: Record<string, string>;
  value: number;
}

function parseMetric(text: string, name: string): Sample[] {
  const out: Sample[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.startsWith(name)) continue;
    const m = /^(\S+?)(\{.*\})?\s+([0-9eE.+-]+)$/.exec(line);
    if (!m || m[1] !== name) continue; // точна назва (щоб _bucket/_count не плутались)
    const labels: Record<string, string> = {};
    if (m[2]) for (const lm of m[2].slice(1, -1).matchAll(/(\w+)="([^"]*)"/g)) labels[lm[1]] = lm[2];
    out.push({ labels, value: Number(m[3]) });
  }
  return out;
}

const forRoute = (s: Sample[]): Sample[] => s.filter((x) => x.labels.route === ROUTE);
const sum = (s: Sample[]): number => s.reduce((a, b) => a + b.value, 0);

async function scrape(port: number): Promise<string> {
  return (await request(port, 'GET', '/metrics')).body;
}

async function main(): Promise<void> {
  startOtel({ inMemory: true });
  const { createLogger } = await import('./logger');
  const { makeApp } = await import('./app');
  const { resetMetrics } = await import('./metrics');

  const logger = createLogger({ stream: captureStream([]) }); // логи демо не цікавлять
  const app = await makeApp(logger);
  const port = app.port;
  resetMetrics(); // чистий стан на старті

  // 🔴 Прогрів маршруту ОДНИМ запитом — щоб series-before рахувався на наявному ряді.
  await request(port, 'POST', '/orders/warm', { headers: { traceparent: traceparent().header } });

  // Скрейп 1 (після прогріву)
  let text = await scrape(port);
  const counterBefore = sum(forRoute(parseMetric(text, 'http_requests_total')));
  const errorsBefore = sum(
    forRoute(parseMetric(text, 'http_requests_total')).filter((s) => s.labels.status.startsWith('5')),
  );
  const seriesBefore = forRoute(parseMetric(text, 'http_requests_total')).length;

  // Кардинальність: 100 OK зі СТА різними id (route — шаблон → жодного нового ряду)
  const CARD = 100;
  const okResults = await Promise.all(
    Array.from({ length: CARD }, (_, i) =>
      request(port, 'POST', `/orders/id-${i}`, { headers: { traceparent: traceparent().header } }),
    ),
  );
  const sentOk = okResults.filter((r) => r.status >= 200 && r.status < 300).length;

  // Скрейп 2 (після кардинальності, ДО fail-батчу)
  text = await scrape(port);
  const seriesAfter = forRoute(parseMetric(text, 'http_requests_total')).length;

  // RED: падучий батч (5xx)
  const FAIL = 30;
  const failResults = await Promise.all(
    Array.from({ length: FAIL }, (_, i) =>
      request(port, 'POST', `/orders/f-${i}`, {
        headers: { traceparent: traceparent().header, 'x-fail': '1' },
      }),
    ),
  );
  const sentFail = failResults.filter((r) => r.status >= 500).length;

  // Скрейп 3 (після fail-батчу)
  text = await scrape(port);
  const counterAfter = sum(forRoute(parseMetric(text, 'http_requests_total')));
  const errorsAfter = sum(
    forRoute(parseMetric(text, 'http_requests_total')).filter((s) => s.labels.status.startsWith('5')),
  );
  const countForRoute = sum(forRoute(parseMetric(text, 'http_request_duration_seconds_count')));
  const bucketLeTop = sum(
    forRoute(parseMetric(text, 'http_request_duration_seconds_bucket')).filter(
      (s) => s.labels.le === '5',
    ),
  );

  const r: Record<string, number> = {
    'sent-ok': sentOk,
    'sent-fail': sentFail,
    'counter-delta': counterAfter - counterBefore,
    'errors-delta': errorsAfter - errorsBefore,
    'above-top-bucket': countForRoute - bucketLeTop,
    'series-before': seriesBefore,
    'series-after': seriesAfter,
  };

  await app.close();
  await shutdownOtel();

  for (const [k, v] of Object.entries(r)) console.log(`${k}=${v}`);
  const ok =
    r['sent-ok'] + r['sent-fail'] >= 50 &&
    r['counter-delta'] === r['sent-ok'] + r['sent-fail'] &&
    r['errors-delta'] === r['sent-fail'] &&
    r['above-top-bucket'] === 0 &&
    r['series-after'] === r['series-before'];
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:metrics FAILED:', err);
  process.exit(1);
});
