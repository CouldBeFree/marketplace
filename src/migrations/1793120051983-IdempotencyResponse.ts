import { MigrationInterface, QueryRunner } from "typeorm";

// ДЗ #22, рев'ю-фікс: серверна механіка Idempotency-Key на API-краю (POST /orders) —
// у БД, а не в пам'яті процесу. idempotency_keys отримує:
//   body_hash — хеш тіла запиту: той самий ключ + те саме тіло → replay збереженої
//               відповіді; той самий ключ + ІНШЕ тіло → 422 (намір, а не тіло).
//   response  — збережена відповідь (201 Order), щоб повтор віддав ту саму, переживши
//               рестарт процесу й будучи спільною між інстансами (in-memory Map — ні).
export class IdempotencyResponse1793120051983 implements MigrationInterface {
    name = 'IdempotencyResponse1793120051983'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "idempotency_keys" ADD "body_hash" text`);
        await queryRunner.query(`ALTER TABLE "idempotency_keys" ADD "response" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "idempotency_keys" DROP COLUMN "response"`);
        await queryRunner.query(`ALTER TABLE "idempotency_keys" DROP COLUMN "body_hash"`);
    }

}
