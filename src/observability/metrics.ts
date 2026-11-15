import client from 'prom-client';

export const registry = new client.Registry();

// RED: Rate — лічильник запитів; Errors — той самий лічильник із фільтром 5xx; Duration — гістограма.
// Лейбл route — ШАБЛОН (/orders/:id), а не сирий шлях: інакше сто різних id дали б сто рядів.
export const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests total',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

// Бакети покривають РЕАЛЬНИЙ діапазон: верхній СКІНЧЕННИЙ le (5с) більший за найгірший випадок
// демо (повільний ендпоїнт ~0.3с). Інакше histogram_quantile упреться в межу й покаже здорову
// лінію саме тоді, коли все погано.
export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export function recordRequest(
  method: string,
  route: string,
  status: number,
  durationSeconds: number,
): void {
  const labels = { method, route, status: String(status) };
  httpRequests.inc(labels);
  httpDuration.observe(labels, durationSeconds);
}

export function metricsText(): Promise<string> {
  return registry.metrics();
}

export function resetMetrics(): void {
  registry.resetMetrics();
}

export const DURATION_TOP_FINITE_BUCKET = 5; // найбільший скінченний le — для above-top-bucket
