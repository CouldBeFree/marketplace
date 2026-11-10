import 'reflect-metadata';
import net from 'net';
import path from 'path';
import { fork } from 'child_process';
import { randomUUID } from 'crypto';
import { bootApp, portOf, poolOf, cleanAndSeed, makeClient } from '../auth/demo-util';
import { TokenService } from '../auth/token.service';
import { makeS3, storageConfig } from '../storage/s3';
import { presignPut, deletePrefix } from '../storage/object-store';

// demo:upload ⭐ — presigned: байти йдуть ПОВЗ наш сервіс (api-alive=0 + put-offline=200), ключ
// генерує сервер (шкідливий filename не доїжджає), підпис накриває шлях (tampered=403), строк
// скінченний (expired=403), commit чесний (без байтів → 4xx).
// Очікуємо: intent=200 key-from-server=1 api-alive=0 put-offline=200 commit=200
//           commit-without-bytes=409 tampered=403 expired=403.

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Живість порту — СИРИМ сокетом (не fetch: глобальний fetch тримає пул на host:port і після
// зупинки сервера може дістати мертвий сокет, що висить до таймауту).
function portAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

// PUT робить ОКРЕМИЙ процес із ЧИСТИМ оточенням (жодного STORAGE-ключа) — доказ, що бекенд не в
// шляху даних. Presigned URL несе підпис у query, тож креди не потрібні.
function putOffline(url: string, body: Buffer, contentType: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'put-child.js'), [], {
      env: { PATH: process.env.PATH, PUT_URL: url, PUT_BODY_B64: body.toString('base64'), PUT_CT: contentType },
    });
    const guard = setTimeout(() => {
      child.kill();
      reject(new Error('put-child timeout'));
    }, 15000);
    child.on('message', (m: { status: number }) => {
      clearTimeout(guard);
      resolve(m.status);
    });
    child.on('error', (e) => {
      clearTimeout(guard);
      reject(e);
    });
  });
}

async function main(): Promise<void> {
  const cfg = storageConfig();
  const s3 = makeS3(cfg);

  let app = await bootApp();
  const pool = poolOf(app);
  const userId = (await cleanAndSeed(pool, [
    { email: 'uploader@files.local', password: 'uploader-pw', role: 'buyer' },
  ]))['uploader@files.local'];
  const token = app.get(TokenService).signAccess(userId, 'buyer', randomUUID()).token;

  // self-clean (критерій 4 ганяє демо двічі): прибрати файли цього юзера — БД + об'єкти
  await pool.query(`DELETE FROM files WHERE owner_id = $1`, [userId]);
  await deletePrefix(s3, cfg.bucket, `uploads/${userId}/`);

  const http = makeClient(portOf(app));
  const r: Record<string, number> = {};
  const body = Buffer.from(`fake-png-${randomUUID()}`);
  const CT = 'image/png';

  // intent зі ШКІДЛИВИМ filename
  const intent = await http('POST', '/uploads/intent', {
    token,
    body: { contentType: CT, size: body.length, filename: '../../etc/passwd' },
  });
  r['intent'] = intent.status;
  const { fileId, key, url } = intent.json as { fileId: string; key: string; url: string };
  r['key-from-server'] =
    !/(\.\.|etc|passwd)/.test(key) && key.startsWith(`uploads/${userId}/`) ? 1 : 0;

  // tampered: зіпсувати шлях у presigned → підпис не збігається → 403
  const [p, q] = url.split('?');
  r['tampered'] = (
    await fetch(`${p}x?${q}`, { method: 'PUT', headers: { 'content-type': CT }, body })
  ).status;

  // expired: presigned на 1с, чекаємо 2с → 403
  const expiredUrl = await presignPut(s3, cfg.bucket, `uploads/${userId}/${randomUUID()}.png`, CT, 1);
  await sleep(2000);
  r['expired'] = (
    await fetch(expiredUrl, { method: 'PUT', headers: { 'content-type': CT }, body })
  ).status;

  // commit БЕЗ байтів: новий намір, нічого не залили, одразу commit → 4xx (HeadObject 404)
  const intent2 = await http('POST', '/uploads/intent', { token, body: { contentType: CT, size: body.length } });
  const fileId2 = (intent2.json as { fileId: string }).fileId;
  r['commit-without-bytes'] = (await http('POST', '/uploads/commit', { token, body: { fileId: fileId2 } })).status;

  // ⭐ зупиняємо НАШ застосунок і кладемо байти окремим процесом без кредів
  const deadPort = portOf(app);
  await app.close();
  r['api-alive'] = (await portAlive(deadPort)) ? 1 : 0;
  r['put-offline'] = await putOffline(url, body, CT);

  // піднімаємо API на ІНШОМУ порту (ефемерний) і чесно комітимо
  app = await bootApp();
  const http2 = makeClient(portOf(app));
  r['commit'] = (await http2('POST', '/uploads/commit', { token, body: { fileId } })).status;

  // cleanup
  await poolOf(app).query(`DELETE FROM files WHERE owner_id = $1`, [userId]);
  await deletePrefix(s3, cfg.bucket, `uploads/${userId}/`);
  await app.close();

  for (const [k, v] of Object.entries(r)) console.log(`${k}=${v}`);
  const ok =
    r['intent'] === 200 &&
    r['key-from-server'] === 1 &&
    r['api-alive'] === 0 &&
    r['put-offline'] === 200 &&
    r['commit'] === 200 &&
    r['commit-without-bytes'] >= 400 &&
    r['commit-without-bytes'] < 500 &&
    r['tampered'] === 403 &&
    r['expired'] === 403;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:upload FAILED:', err);
  process.exit(1);
});
