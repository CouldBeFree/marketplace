import http from 'http';
import type { AddressInfo } from 'net';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { makeS3, storageConfig } from './s3';
import { isNotFound } from './object-store';

// Кеш-шар (edge) перед ЗАКРИТИМ бакетом — суть OAC: до сховища ходить edge СВОЇМИ кредами, а
// публіка ходить лише в edge. Прямий анонімний запит у бакет дає 403 (demo:cdn direct=403).
// Кешуємо ЛИШЕ коли origin віддав Cache-Control (інакше нема чого кешувати → cache-hit=0).
export interface Edge {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

interface CacheEntry {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

export async function startEdge(): Promise<Edge> {
  const cfg = storageConfig();
  const s3 = makeS3(cfg);
  const cache = new Map<string, CacheEntry>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const key = decodeURIComponent((req.url ?? '/').replace(/^\/+/, '').split('?')[0]);
      const hit = cache.get(key);
      if (hit) {
        res.writeHead(200, {
          'content-type': hit.contentType,
          'cache-control': hit.cacheControl,
          'x-cache': 'HIT',
        });
        res.end(hit.body);
        return;
      }
      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const body = Buffer.from(await obj.Body!.transformToByteArray());
        const entry: CacheEntry = {
          body,
          contentType: obj.ContentType ?? 'application/octet-stream',
          cacheControl: obj.CacheControl ?? '',
        };
        if (entry.cacheControl) cache.set(key, entry); // кешуємо лише за наявності Cache-Control
        res.writeHead(200, {
          'content-type': entry.contentType,
          'cache-control': entry.cacheControl,
          'x-cache': 'MISS',
        });
        res.end(body);
      } catch (err) {
        const code = isNotFound(err) ? 404 : 502;
        res.writeHead(code, { 'content-type': 'text/plain' });
        res.end(code === 404 ? 'not found' : 'origin error');
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
