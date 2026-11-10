import { startEdge } from '../storage/edge';
import { makeS3, storageConfig } from '../storage/s3';
import { publishAsset, deleteObject, hashedAssetKey } from '../storage/object-store';

// demo:cdn ⭐ — сховище ЗАКРИТЕ (direct=403), роздача через кеш (edge-miss→edge-hit, cache-hit=1),
// оновлення БЕЗ інвалідації: новий вміст приїжджає під НОВИМ іменем (хеш вмісту), стара версія в
// кеші нікому не заважає. Мутабельне ім'я дало б new-name=0 і content-changed=0.
// Очікуємо: direct=403 edge-miss=200 edge-hit=200 cache-hit=1 new-name=1 new-url=200 content-changed=1.

const BASE = 'app.css';
const CT = 'text/css';
const V1 = Buffer.from('body { color: red; }\n');
const V2 = Buffer.from('body { color: blue; }\n');

async function main(): Promise<void> {
  const cfg = storageConfig();
  const s3 = makeS3(cfg);
  const bucket = cfg.bucket;

  // self-clean: прибрати обидві можливі версії (демо детерміноване, тож імена відомі наперед)
  await deleteObject(s3, bucket, hashedAssetKey(V1, BASE)).catch(() => undefined);
  await deleteObject(s3, bucket, hashedAssetKey(V2, BASE)).catch(() => undefined);

  const edge = await startEdge();
  const r: Record<string, number> = {};

  // «деплой» v1 (Cache-Control ставиться на ОБ'ЄКТ при завантаженні — без нього cache-hit=0)
  const key1 = await publishAsset(s3, bucket, V1, BASE, CT);

  // direct: анонімний GET ПРЯМО у сховище, повз кеш → 403 (бакет не читається публікою)
  r['direct'] = (await fetch(`${cfg.endpoint}/${bucket}/${key1}`)).status;

  // роздача через edge: перший — MISS, другий — HIT із кешу
  const miss = await fetch(`http://127.0.0.1:${edge.port}/${key1}`);
  r['edge-miss'] = miss.status;
  const hit = await fetch(`http://127.0.0.1:${edge.port}/${key1}`);
  r['edge-hit'] = hit.status;
  r['cache-hit'] = hit.headers.get('x-cache') === 'HIT' ? 1 : 0;
  const oldBody = await hit.text();

  // «деплой» v2: новий вміст → інший хеш → інше ім'я; інвалідацій нуль
  const key2 = await publishAsset(s3, bucket, V2, BASE, CT);
  r['new-name'] = key2 !== key1 ? 1 : 0;
  const fresh = await fetch(`http://127.0.0.1:${edge.port}/${key2}`);
  r['new-url'] = fresh.status;
  const newBody = await fresh.text();
  r['content-changed'] = newBody !== oldBody ? 1 : 0;

  // cleanup
  await deleteObject(s3, bucket, key1).catch(() => undefined);
  await deleteObject(s3, bucket, key2).catch(() => undefined);
  await edge.close();

  for (const [k, v] of Object.entries(r)) console.log(`${k}=${v}`);
  const ok =
    r['direct'] === 403 &&
    r['edge-miss'] === 200 &&
    r['edge-hit'] === 200 &&
    r['cache-hit'] === 1 &&
    r['new-name'] === 1 &&
    r['new-url'] === 200 &&
    r['content-changed'] === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:cdn FAILED:', err);
  process.exit(1);
});
