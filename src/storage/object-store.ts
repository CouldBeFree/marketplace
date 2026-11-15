import { createHash, randomUUID } from 'crypto';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── allowlist contentType → розширення. Розширення беремо ЗВІДСИ, а не з filename клієнта:
// Content-Type від клієнта — це його слова, але принаймні тип ми звужуємо до відомого набору.
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/css': 'css',
  'application/gzip': 'gz',
  'application/octet-stream': 'bin',
};

export function extFor(contentType: string): string | null {
  return EXT_BY_TYPE[contentType] ?? null;
}

// 🔴 Ключ ГЕНЕРУЄ СЕРВЕР: uploads/{userId}/{uuid}.{ext}. filename клієнта сюди не потрапляє —
// інакше ти віддав клієнту право писати за будь-яким шляхом у бакеті (../../ → path traversal).
export function buildKey(userId: string, contentType: string): string | null {
  const ext = extFor(contentType);
  if (!ext) return null;
  return `uploads/${userId}/${randomUUID()}.${ext}`;
}

// Строк presigned — свідомий: завантаження з форми живе хвилинами, не днями. Presigned не можна
// відкликати (ні jti, ні реєстру), тому єдиний запобіжник проти витоку URL — короткий строк.
export const PRESIGN_PUT_TTL_SEC = 300; // 5 хв
export const PRESIGN_GET_TTL_SEC = 60; // 1 хв (для GET /files/:id → 302)

export function presignPut(
  s3: S3Client,
  bucket: string,
  key: string,
  _contentType: string,
  ttl = PRESIGN_PUT_TTL_SEC,
): Promise<string> {
  // Content-Type НЕ підписуємо свідомо: якби підписали, клієнт мусив би надіслати ТОЧНО той самий
  // заголовок, і дрібна розбіжність (charset, регістр) дала б SignatureDoesNotMatch на деяких
  // S3-сумісних сховищах. Тип ми вже звузили allowlist-ом при генерації ключа (розширення звідти),
  // а сам об'єкт дістане content-type із заголовка PUT. Підпис накриває метод+шлях+строк — цього
  // досить для tampered=403/expired=403.
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttl });
}

export function presignGet(s3: S3Client, bucket: string, key: string, ttl = PRESIGN_GET_TTL_SEC): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttl });
}

export interface HeadResult {
  size: number;
  etag: string;
}

export async function headObject(s3: S3Client, bucket: string, key: string): Promise<HeadResult | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(r.ContentLength ?? 0), etag: r.ETag ?? '' };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

// ── multipart ─────────────────────────────────────────────────────────────────────────────
// S3: частин максимум 10 000 і мінімум 5 МіБ на частину (крім останньої). Тому partSize РАХУЄМО,
// а не вписуємо константою: інакше жорсткі 5 МіБ на файлі понад 50 ГБ впадуть (10000×5МіБ=49ГБ).
export const PART_MIN = 5 * 1024 * 1024; // 5 МіБ
export const MULTIPART_THRESHOLD = 2 * PART_MIN; // > 10 МіБ → multipart

export function computePartSize(size: number): number {
  return Math.max(PART_MIN, Math.ceil(size / 10000));
}

export interface PartRef {
  PartNumber: number;
  ETag: string;
}

export async function createMultipart(
  s3: S3Client,
  bucket: string,
  key: string,
  contentType: string,
): Promise<string> {
  const r = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
  );
  return r.UploadId as string;
}

export function presignPart(
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  ttl = PRESIGN_PUT_TTL_SEC,
): Promise<string> {
  return getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: ttl },
  );
}

// Серце відновлення: які частини ВЖЕ на сервері. Новий процес питає це й доливає лише те, чого бракує.
export async function listParts(
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<PartRef[]> {
  const r = await s3.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  return (r.Parts ?? []).map((p) => ({ PartNumber: p.PartNumber as number, ETag: p.ETag as string }));
}

// Повертає HTTP-статус Complete + ETag (у multipart ETag має суфікс -N, і це НЕ MD5 файла).
export async function completeMultipart(
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  parts: PartRef[],
): Promise<{ status: number; etag: string }> {
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
  const r = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
    }),
  );
  return { status: r.$metadata.httpStatusCode ?? 0, etag: r.ETag ?? '' };
}

// ── cleanup (самоочистка демо + гігієна бакета) ─────────────────────────────────────────────
// Прибрати НЕЗАВЕРШЕНІ multipart-завантаження за ключем (інакше вони тарифікуються й ListParts
// на другому прогоні бачить чужі частини).
export async function abortMultipartFor(s3: S3Client, bucket: string, key: string): Promise<number> {
  const r = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }));
  let aborted = 0;
  for (const u of r.Uploads ?? []) {
    if (u.Key === key && u.UploadId) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: u.UploadId }));
      aborted++;
    }
  }
  return aborted;
}

export async function deleteObject(s3: S3Client, bucket: string, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deletePrefix(s3: S3Client, bucket: string, prefix: string): Promise<void> {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  for (const o of r.Contents ?? []) {
    if (o.Key) await deleteObject(s3, bucket, o.Key);
  }
}

// ── версійні ассети для CDN ─────────────────────────────────────────────────────────────────
// Імʼя містить хеш вмісту (app.15c42ab7.css) → оновлення = новий URL, стара версія в кеші нікому
// не заважає, інвалідацій нуль. Cache-Control ставимо НА ОБʼЄКТ при завантаженні (не в edge) —
// без нього кеш-шару нема чого кешувати і cache-hit=0.
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function hashedAssetKey(content: Buffer, baseName: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  const dot = baseName.lastIndexOf('.');
  return dot === -1
    ? `${baseName}.${hash}`
    : `${baseName.slice(0, dot)}.${hash}${baseName.slice(dot)}`;
}

export async function publishAsset(
  s3: S3Client,
  bucket: string,
  content: Buffer,
  baseName: string,
  contentType: string,
): Promise<string> {
  const key = hashedAssetKey(content, baseName);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );
  return key;
}
