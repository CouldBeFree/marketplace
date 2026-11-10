import { MigrationInterface, QueryRunner } from 'typeorm';

// ДЗ #24: таблиця refresh-токенів для ротації з ДЕТЕКЦІЄЮ ПОВТОРУ.
//  - token_hash: HMAC(pepper, token), НЕ сам токен → дамп таблиці ≠ дамп чинних сесій.
//  - family_id: усі токени одного логіна в одній сімʼї; повтор валить сімʼю цілком.
//  - used_at: ротований токен позначається використаним; повторне предʼявлення → сигнал.
//  - revoked_at: відкликання (логаут або детекція повтору) — на всю сімʼю одним UPDATE.
//  - expires_at: власний строк життя refresh (перевіряємо ми, не бібліотека).
// Унікальний індекс по token_hash — і швидкий пошук, і захист від колізії вставки.
export class RefreshTokens1793200000002 implements MigrationInterface {
  name = 'RefreshTokens1793200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "user_id" bigint NOT NULL,
        "family_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "refresh_tokens_token_hash_uq" ON "refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_user"`,
    );
    await queryRunner.query(`DROP INDEX "public"."refresh_tokens_family_idx"`);
    await queryRunner.query(`DROP INDEX "public"."refresh_tokens_token_hash_uq"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
