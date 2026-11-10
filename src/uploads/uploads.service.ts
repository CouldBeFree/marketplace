import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import type { S3Client } from '@aws-sdk/client-s3';
import { PG_POOL } from '../database/database.module';
import { makeS3, storageConfig } from '../storage/s3';
import {
  buildKey,
  presignPut,
  presignGet,
  headObject,
  createMultipart,
  presignPart,
  computePartSize,
  MULTIPART_THRESHOLD,
} from '../storage/object-store';

export interface IntentResult {
  fileId: string;
  key: string;
  multipart: boolean;
  url?: string; // простий PUT
  uploadId?: string; // multipart
  partSize?: number;
  partUrls?: string[];
}

export interface CommitResult {
  fileId: string;
  status: 'COMPLETED';
  size: number;
}

@Injectable()
export class UploadsService {
  private s3?: S3Client;
  private bucket?: string;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Лінива ініціалізація: застосунок стартує й без STORAGE_* (опційні), а клієнт створюється на
  // перший реальний запит — тоді ж і кидає ясну помилку, якщо креди не задані.
  private store(): { s3: S3Client; bucket: string } {
    if (!this.s3) {
      const cfg = storageConfig();
      this.s3 = makeS3(cfg);
      this.bucket = cfg.bucket;
    }
    return { s3: this.s3, bucket: this.bucket as string };
  }

  // Крок 1: право перевірив гард; тут валідуємо contentType за allowlist, САМІ генеруємо ключ
  // (filename клієнта в нього не потрапляє) і кладемо рядок PENDING. Понад поріг — multipart.
  async intent(
    userId: string,
    contentType: string,
    size?: number,
  ): Promise<IntentResult> {
    const key = buildKey(userId, contentType);
    if (!key) {
      throw new BadRequestException(`contentType '${contentType}' не в allowlist`);
    }
    const { s3, bucket } = this.store();

    if (size !== undefined && size > MULTIPART_THRESHOLD) {
      const uploadId = await createMultipart(s3, bucket, key, contentType);
      const partSize = computePartSize(size);
      const partCount = Math.ceil(size / partSize);
      const partUrls: string[] = [];
      for (let n = 1; n <= partCount; n++) {
        partUrls.push(await presignPart(s3, bucket, key, uploadId, n));
      }
      const fileId = await this.insertPending(key, userId, contentType, size, uploadId);
      return { fileId, key, multipart: true, uploadId, partSize, partUrls };
    }

    const url = await presignPut(s3, bucket, key, contentType);
    const fileId = await this.insertPending(key, userId, contentType, size ?? null, null);
    return { fileId, key, multipart: false, url };
  }

  private async insertPending(
    key: string,
    ownerId: string,
    contentType: string,
    size: number | null,
    uploadId: string | null,
  ): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO files (key, owner_id, status, content_type, size, upload_id)
       VALUES ($1, $2, 'PENDING', $3, $4, $5) RETURNING id`,
      [key, ownerId, contentType, size, uploadId],
    );
    return String(rows[0].id);
  }

  // Крок 2: HeadObject звіряє, що байти РЕАЛЬНО в сховищі (і розмір, якщо знаємо) — без цього
  // клієнт «комітить» те, чого не заливав. Лише після цього COMPLETED.
  async commit(userId: string, fileId: string): Promise<CommitResult> {
    const { rows } = await this.pool.query(
      `SELECT id, key, owner_id, size FROM files WHERE id = $1`,
      [fileId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException(`file ${fileId} not found`);
    if (String(row.owner_id) !== userId) throw new ForbiddenException('not your file');

    const { s3, bucket } = this.store();
    const head = await headObject(s3, bucket, row.key);
    if (!head) {
      throw new ConflictException('object not uploaded (HeadObject 404)'); // 409 → commit-without-bytes=4xx
    }
    const expected = row.size === null ? null : Number(row.size);
    if (expected !== null && head.size !== expected) {
      throw new ConflictException(`size mismatch: expected ${expected}, got ${head.size}`);
    }

    await this.pool.query(`UPDATE files SET status = 'COMPLETED', size = $2 WHERE id = $1`, [
      fileId,
      head.size,
    ]);
    return { fileId, status: 'COMPLETED', size: head.size };
  }

  // GET /files/:id → свіжий presigned на хвилину. Сервіс лишається у шляху АВТОРИЗАЦІЇ (гард на
  // кожен запит), але не у шляху ДАНИХ; presigned короткий, бо відкликати його не можна.
  async freshGetUrl(userId: string, fileId: string): Promise<string> {
    const { rows } = await this.pool.query(
      `SELECT key, owner_id, status FROM files WHERE id = $1`,
      [fileId],
    );
    const row = rows[0];
    if (!row || row.status !== 'COMPLETED') throw new NotFoundException(`file ${fileId} not found`);
    if (String(row.owner_id) !== userId) throw new ForbiddenException('not your file');
    const { s3, bucket } = this.store();
    return presignGet(s3, bucket, row.key);
  }
}
