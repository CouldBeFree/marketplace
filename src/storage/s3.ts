import { S3Client } from '@aws-sdk/client-s3';

export interface StorageConfig {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

// Конфіг зі сховища #11 (через оточення). Кидає, якщо креди не задані — застосунок стартує й без
// них (опційні), але /uploads та демо без них працювати не можуть (fail-fast з ясною причиною).
export function storageConfig(): StorageConfig {
  const { STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET } =
    process.env;
  if (!STORAGE_ACCESS_KEY || !STORAGE_SECRET_KEY || !STORAGE_BUCKET) {
    throw new Error(
      'STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY/STORAGE_BUCKET не задані (зі сховища #11 через with-secrets)',
    );
  }
  return {
    endpoint: STORAGE_ENDPOINT || undefined, // порожньо → справжній AWS S3
    region: STORAGE_REGION || 'us-east-1',
    accessKeyId: STORAGE_ACCESS_KEY,
    secretAccessKey: STORAGE_SECRET_KEY,
    bucket: STORAGE_BUCKET,
  };
}

export function makeS3(cfg: StorageConfig = storageConfig()): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // емуляторам (MinIO/LocalStack) потрібен path-style: bucket у шляху, не в піддомені
    forcePathStyle: Boolean(cfg.endpoint),
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // 🔴 presigned підписується, коли тіла ще немає → з дефолтним WHEN_SUPPORTED у query їде
    // x-amz-checksum-crc32 порожніх даних, і сторонні S3-сумісні сховища відхиляють PUT. WHEN_REQUIRED
    // рахує контрольну суму лише там, де S3 її вимагає (напр. CompleteMultipartUpload).
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}
