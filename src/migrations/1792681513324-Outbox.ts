import { MigrationInterface, QueryRunner } from "typeorm";

// ДЗ #22 — transactional outbox + ідемпотентність.
//
// outbox              — подія пишеться ТІЄЮ Ж транзакцією, що й бізнес-рядок (checkout).
//                       Ролі полів — як читає Debezium Outbox Event Router, тож перехід
//                       на CDC не перепише консюмерів. Канонічні імена Debezium — без
//                       підкреслень (aggregatetype, aggregateid); для snake_case треба
//                       явно перевизначити route.by.field=aggregate_type і
//                       table.field.event.key=aggregate_id (див. README). published_at
//                       IS NULL = ще не винесено; під це — ЧАСТКОВИЙ індекс для relay.
// processed_messages  — inbox (рівень 2): позначка про обробку; (message_id, consumer).
// order_confirmations — ефект через ПРИРОДНИЙ ключ (order_id): повтор нічого не змінює.
// idempotency_keys    — ключ ідемпотентності на API-краю (рівень 3): намір → одне замовлення.
export class Outbox1792681513324 implements MigrationInterface {
    name = 'Outbox1792681513324'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "outbox" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "aggregate_type" text NOT NULL, "aggregate_id" text NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_outbox" PRIMARY KEY ("id"))`);
        // частковий індекс рівно під вибірку relay: тільки ще не винесені рядки
        await queryRunner.query(`CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at", "id") WHERE "published_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "processed_messages" ("message_id" text NOT NULL, "consumer" text NOT NULL, "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer"))`);
        await queryRunner.query(`CREATE TABLE "order_confirmations" ("order_id" bigint NOT NULL, "confirmed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_order_confirmations" PRIMARY KEY ("order_id"))`);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("key" text NOT NULL, "order_id" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP TABLE "order_confirmations"`);
        await queryRunner.query(`DROP TABLE "processed_messages"`);
        await queryRunner.query(`DROP INDEX "public"."outbox_unpublished_idx"`);
        await queryRunner.query(`DROP TABLE "outbox"`);
    }

}
