import { MigrationInterface, QueryRunner } from 'typeorm';

// ДЗ #26: таблиця файлів. Метадані живуть У БД (не листингом сховища — він платний і повільний).
//  - key: ключ обʼєкта у сховищі (генерує СЕРВЕР: uploads/{userId}/{uuid}.{ext}).
//  - status: PENDING одразу на intent; COMPLETED лише після commit (HeadObject підтвердив байти).
//    PENDING-сироти (намір без байтів) добиває cleanup-джоба — див. README.
//  - upload_id: UploadId multipart-завантаження (для ListParts/Complete/Abort); null для простого PUT.
export class Files1794000000001 implements MigrationInterface {
  name = 'Files1794000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "files" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "key" text NOT NULL,
        "owner_id" bigint NOT NULL,
        "status" text NOT NULL DEFAULT 'PENDING',
        "content_type" text NOT NULL,
        "size" bigint,
        "upload_id" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_files_status" CHECK ("status" IN ('PENDING','COMPLETED')),
        CONSTRAINT "PK_files" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "files_key_uq" ON "files" ("key")`);
    await queryRunner.query(`CREATE INDEX "files_owner_idx" ON "files" ("owner_id")`);
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner"
        FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner"`);
    await queryRunner.query(`DROP INDEX "public"."files_owner_idx"`);
    await queryRunner.query(`DROP INDEX "public"."files_key_uq"`);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
