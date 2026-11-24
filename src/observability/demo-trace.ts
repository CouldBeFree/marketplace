import { SpanStatusCode } from '@opentelemetry/api';
import { startOtel, shutdownOtel } from './otel';
import { traceparent, request, parseJson, captureStream } from './demo-util';

// demo:trace ⭐⭐ — ОДИН ключ відчиняє двоє дверей: trace_id у рядку логу = trace_id спана = тому,
// що приїхав у traceparent. 5xx дає спан ERROR. Очікуємо: spans≥2 orphan-spans=0
// trace-matches-header=1 trace-matches-log=1 span-status-error=1.

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  startOtel({ inMemory: true });
  const { createLogger } = await import('./logger');
  const { makeApp } = await import('./app');
  const { resetSpans, getFinishedSpans, forceFlush } = await import('./otel');

  const lines: string[] = [];
  const logger = createLogger({ stream: captureStream(lines) });
  const app = await makeApp(logger);

  resetSpans();
  lines.length = 0;

  // Один запит, що ронить 5xx, із відомим traceparent.
  const tp = traceparent();
  await request(app.port, 'POST', '/orders/boom', {
    headers: { traceparent: tp.header, 'x-fail': '1' },
  });

  // Серверний спан завершується на finish відповіді — дати встигнути + forceFlush (батч шле не одразу).
  await delay(150);
  await forceFlush();
  const spans = getFinishedSpans();

  const spanTraceIds = new Set(spans.map((s) => s.spanContext().traceId));
  const logTraceIds = new Set(
    lines
      .map(parseJson)
      .filter((x): x is Record<string, unknown> => !!x)
      .map((l) => l.trace_id)
      .filter(Boolean),
  );

  const r: Record<string, number> = {};
  r['spans'] = spans.length;
  r['orphan-spans'] = spans.filter((s) => s.spanContext().traceId !== tp.traceId).length;
  r['trace-matches-header'] = spanTraceIds.size === 1 && spanTraceIds.has(tp.traceId) ? 1 : 0;
  r['trace-matches-log'] =
    logTraceIds.size >= 1 && [...logTraceIds].every((id) => id === tp.traceId) ? 1 : 0;
  r['span-status-error'] = spans.some((s) => s.status.code === SpanStatusCode.ERROR) ? 1 : 0;

  await app.close();
  await shutdownOtel();

  for (const [k, v] of Object.entries(r)) console.log(`${k}=${v}`);
  const ok =
    r['spans'] >= 2 &&
    r['orphan-spans'] === 0 &&
    r['trace-matches-header'] === 1 &&
    r['trace-matches-log'] === 1 &&
    r['span-status-error'] === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:trace FAILED:', err);
  process.exit(1);
});
