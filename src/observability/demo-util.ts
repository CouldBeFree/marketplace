import http from 'http';
import { randomBytes } from 'crypto';

// W3C Trace Context: 00-<32hex trace-id>-<16hex parent-id>-<2hex flags>.
export function traceparent(): { header: string; traceId: string } {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return { header: `00-${traceId}-${parentId}-01`, traceId };
}

export interface Resp {
  status: number;
  body: string;
}

export function request(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Resp> {
  return new Promise((resolve) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (data !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(data));
    }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    if (data !== undefined) req.write(data);
    req.end();
  });
}

export function parseJson(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Потік-колектор для pino: кожен рядок логу (JSON) падає сюди.
export function captureStream(sink: string[]): { write(s: string): void } {
  return {
    write(s: string): void {
      sink.push(s.replace(/\n$/, ''));
    },
  };
}
