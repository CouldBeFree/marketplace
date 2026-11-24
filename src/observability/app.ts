import http from 'http';
import type { AddressInfo } from 'net';
import type { Logger } from 'pino';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { childLayer } from './logger';
import { runWithContext } from './context';
import { recordRequest, metricsText } from './metrics';

const tracer = trace.getTracer('marketplace-obs');
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface HandlerResult {
  status: number;
  body: unknown;
}
type Handler = (
  req: http.IncomingMessage,
  params: Record<string, string>,
  logger: Logger,
) => Promise<HandlerResult>;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  template: string;
  handler: Handler;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ── три шари: контролер → сервіс → репозиторій, той самий trace_id у кожному рядку ─────────────
async function ordersRepo(logger: Logger, id: string, fail: boolean): Promise<void> {
  const log = childLayer(logger, 'orders.repo');
  // Вкладений спан — «запис у БД» (щоб spans ≥ 2: серверний + цей).
  await tracer.startActiveSpan('orders.repo.insert', async (span) => {
    log.info({ orderId: id }, 'inserting order');
    await delay(30); // імітація БД, щоб тривалість лягла в середній бакет
    if (fail) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'db write failed' });
      span.end();
      throw new Error('db write failed');
    }
    span.end();
  });
}

async function ordersService(logger: Logger, id: string, fail: boolean): Promise<void> {
  const log = childLayer(logger, 'orders.service');
  log.info({ orderId: id }, 'processing order');
  await ordersRepo(logger, id, fail);
}

async function ordersController(
  req: http.IncomingMessage,
  params: Record<string, string>,
  logger: Logger,
): Promise<HandlerResult> {
  const log = childLayer(logger, 'orders.controller');
  const fail = req.headers['x-fail'] === '1';
  log.info({ orderId: params.id }, 'create order received');
  await ordersService(logger, params.id, fail); // кине на fail → зовнішній catch зробить 500 + ERROR
  return { status: 201, body: { id: params.id, status: 'created' } };
}

// auth-шлях: логуємо ЗАПИТ (secret-req-logged=1), але секрети редагуються шляхами redaction.
async function authController(
  req: http.IncomingMessage,
  _params: Record<string, string>,
  logger: Logger,
): Promise<HandlerResult> {
  const log = childLayer(logger, 'auth.controller');
  const body = await readBody(req);
  log.info(
    {
      method: req.method,
      route: '/auth/login',
      headers: { authorization: req.headers['authorization'] }, // → redact headers.authorization
      body: { password: body.password }, // → redact body.password
    },
    'auth request',
  );
  return { status: 200, body: { ok: true } };
}

const routes: Route[] = [];
function add(method: string, template: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = template.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  });
  routes.push({ method, template, keys, handler, regex: new RegExp(`^${pattern}/?$`) });
}
add('POST', '/orders/:id', ordersController);
add('POST', '/auth/login', authController);

function matchRoute(
  method: string,
  url: string,
): (Route & { params: Record<string, string> }) | null {
  const path = (url || '/').split('?')[0];
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { ...r, params };
    }
  }
  return null;
}

export interface App {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export async function makeApp(logger: Logger, port = 0): Promise<App> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const path = (req.url || '/').split('?')[0];
      // /metrics — текст prom-client (не JSON), поза RED-лейблами
      if (req.method === 'GET' && path === '/metrics') {
        const text = await metricsText();
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
        res.end(text);
        return;
      }

      const route = matchRoute(req.method || 'GET', req.url || '/');
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      // Корелятори запиту — в ALS із заголовків (userId #24, tenant, idempotencyKey #22).
      const ctx = {
        userId: (req.headers['x-user-id'] as string) || undefined,
        tenant: (req.headers['x-tenant'] as string) || undefined,
        idempotencyKey: (req.headers['idempotency-key'] as string) || undefined,
      };

      const start = process.hrtime.bigint();
      let status = 200;
      try {
        const result = await runWithContext(ctx, () => route.handler(req, route.params, logger));
        status = result.status;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        status = 500;
        // Серверний спан (активний тут) → ERROR на 5xx. Для 4xx OTel лишає Unset — тому демо ронить
        // саме 5xx, щоб дістати span-status-error=1.
        trace
          .getActiveSpan()
          ?.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : 'error' });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      } finally {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        // route — ШАБЛОН, не сирий шлях → сто різних id не плодять рядів
        recordRequest(req.method || 'GET', route.template, status, durationSeconds);
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const actualPort = (server.address() as AddressInfo).port;
  return {
    server,
    port: actualPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
