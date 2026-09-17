import { MigrationInterface, QueryRunner } from "typeorm";

export class Concurrency1789201579857 implements MigrationInterface {
    name = 'Concurrency1789201579857'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tasks" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "order_id" bigint NOT NULL, "kind" text NOT NULL DEFAULT 'email', "status" text NOT NULL DEFAULT 'pending', "processed" integer NOT NULL DEFAULT '0', "locked_by" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_tasks_status" CHECK ("status" IN ('pending','done')), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "tasks_pending_idx" ON "tasks"  ("created_at") WHERE status = 'pending'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "balance_cents" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "CHK_products_stock" CHECK ("stock" >= 0)`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_balance_cents" CHECK ("balance_cents" >= 0)`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_ebc795fe637f4e8c0cfcb392e59" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_ebc795fe637f4e8c0cfcb392e59"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_balance_cents"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "CHK_products_stock"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
        await queryRunner.query(`DROP INDEX "public"."tasks_pending_idx"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
    }

}
