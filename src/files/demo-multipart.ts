import { UploadPartCommand, S3Client } from '@aws-sdk/client-s3';
import { makeS3, storageConfig } from '../storage/s3';
import {
  createMultipart,
  listParts,
  completeMultipart,
  headObject,
  abortMultipartFor,
  deleteObject,
  computePartSize,
} from '../storage/object-store';

// demo:multipart ⭐ — multipart це ВІДНОВЛЕННЯ. Процес «падає» після 2 частин із 3; новий процес
// питає ListParts, бачить, які вже на сервері, і доливає ЛИШЕ відсутню → resumed-parts=1 (а не 3).
// До Complete об'єкта не існує (head-before-complete=404), хоча частини лежать; після Complete
// розмір збігається, а ETag має суфікс -N (і це НЕ MD5 файла).
// Очікуємо: head-before-complete=404 resumed-parts=1 complete=200 size-match=1 etag-multipart=1.
// Самоочисне (критерій 4 ганяє двічі): на старті прибираємо і незавершені завантаження, і об'єкт.

const KEY = 'uploads/multipart-demo/bigfile.bin';
const CT = 'application/octet-stream';
const FILE_SIZE = 15 * 1024 * 1024; // 3 частини по 5 МіБ (мінімум S3 на всі, крім останньої)

async function uploadPart(
  s3: S3Client,
  bucket: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
): Promise<void> {
  await s3.send(
    new UploadPartCommand({ Bucket: bucket, Key: KEY, UploadId: uploadId, PartNumber: partNumber, Body: body }),
  );
}

async function main(): Promise<void> {
  const cfg = storageConfig();
  const s3 = makeS3(cfg);
  const bucket = cfg.bucket;

  // self-clean: і незавершені multipart (ListMultipartUploads→Abort), і сам об'єкт
  await abortMultipartFor(s3, bucket, KEY);
  await deleteObject(s3, bucket, KEY).catch(() => undefined);

  const file = Buffer.alloc(FILE_SIZE, 0x61);
  const partSize = computePartSize(FILE_SIZE);
  const partCount = Math.ceil(FILE_SIZE / partSize);
  const slice = (n: number): Buffer => file.subarray((n - 1) * partSize, Math.min(n * partSize, FILE_SIZE));

  const uploadId = await createMultipart(s3, bucket, KEY, CT);

  // «процес 1»: заливає 2 частини з 3 і «падає»
  await uploadPart(s3, bucket, uploadId, 1, slice(1));
  await uploadPart(s3, bucket, uploadId, 2, slice(2));

  const r: Record<string, number> = {};
  r['head-before-complete'] = (await headObject(s3, bucket, KEY)) ? 200 : 404;

  // «процес 2»: ListParts → що вже є → доливаємо ЛИШЕ відсутнє
  const have = new Set((await listParts(s3, bucket, KEY, uploadId)).map((p) => p.PartNumber));
  const missing: number[] = [];
  for (let n = 1; n <= partCount; n++) if (!have.has(n)) missing.push(n);
  for (const n of missing) await uploadPart(s3, bucket, uploadId, n, slice(n));
  r['resumed-parts'] = missing.length;

  // Complete з усіма частинами (ETag-и — із ListParts, джерела правди сервера)
  const done = await completeMultipart(s3, bucket, KEY, uploadId, await listParts(s3, bucket, KEY, uploadId));
  r['complete'] = done.status;

  const head = await headObject(s3, bucket, KEY);
  r['size-match'] = head && head.size === FILE_SIZE ? 1 : 0;
  r['etag-multipart'] = /-\d+"?$/.test(done.etag || head?.etag || '') ? 1 : 0;

  // cleanup
  await deleteObject(s3, bucket, KEY).catch(() => undefined);
  await abortMultipartFor(s3, bucket, KEY);

  for (const [k, v] of Object.entries(r)) console.log(`${k}=${v}`);
  const ok =
    r['head-before-complete'] === 404 &&
    r['resumed-parts'] === 1 &&
    r['complete'] === 200 &&
    r['size-match'] === 1 &&
    r['etag-multipart'] === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('demo:multipart FAILED:', err);
  process.exit(1);
});
