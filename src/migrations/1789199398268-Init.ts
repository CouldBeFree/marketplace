import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1789199398268 implements MigrationInterface {
    name = 'Init1789199398268'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "products" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "seller_id" bigint NOT NULL, "title" text NOT NULL, "price_cents" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_products_price_cents" CHECK ("price_cents" >= 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "order_id" bigint NOT NULL, "product_id" bigint NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" integer NOT NULL, CONSTRAINT "CHK_order_items_unit_price_cents" CHECK ("unit_price_cents" >= 0), CONSTRAINT "CHK_order_items_quantity" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "buyer_id" bigint NOT NULL, "status" text NOT NULL, "shipping_name" text NOT NULL, "total_cents" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_orders_status" CHECK ("status" IN ('pending','paid','shipped','completed','cancelled')), CONSTRAINT "CHK_orders_total_cents" CHECK ("total_cents" >= 0), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "orders_pending_created_idx" ON "orders"  ("created_at") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "orders_buyer_created_idx" ON "orders"  ("buyer_id", "created_at" DESC) `);
        // expression-індекс під q3 (lower(shipping_name)) — декоратором не виражається, тому руками
        await queryRunner.query(`CREATE INDEX "orders_shipping_name_lower_idx" ON "orders" (lower("shipping_name"))`);
        // індекси на FK-колонки order_items: без них join у report і наївний цикл — seq scan
        await queryRunner.query(`CREATE INDEX "order_items_order_id_idx" ON "order_items" ("order_id")`);
        await queryRunner.query(`CREATE INDEX "order_items_product_id_idx" ON "order_items" ("product_id")`);
        await queryRunner.query(`CREATE TABLE "users" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "email" text NOT NULL, "full_name" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."orders_shipping_name_lower_idx"`);
        await queryRunner.query(`DROP INDEX "public"."orders_buyer_created_idx"`);
        await queryRunner.query(`DROP INDEX "public"."orders_pending_created_idx"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP INDEX "public"."order_items_product_id_idx"`);
        await queryRunner.query(`DROP INDEX "public"."order_items_order_id_idx"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP TABLE "products"`);
    }

}
