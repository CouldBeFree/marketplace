import { MigrationInterface, QueryRunner } from 'typeorm';

// ДЗ #24: автентифікація/авторизація на users.
// role — ДЖЕРЕЛО ПРАВДИ для RBAC (у токені вона лише КЕШ до exp). password_hash — scrypt-хеш
// (node:crypto), не голий пароль. Міграцією, не synchronize (контракт ДЗ #13).
export class AuthUsers1793200000001 implements MigrationInterface {
  name = 'AuthUsers1793200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "role" text NOT NULL DEFAULT 'buyer'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('buyer','seller','admin'))`,
    );
    // nullable: сід-юзери з ДЗ #13 пароля не мають; login-юзери його проставляють (upsert)
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "password_hash" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
  }
}
