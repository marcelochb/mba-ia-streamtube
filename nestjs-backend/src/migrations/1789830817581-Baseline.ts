import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline migration.
 *
 * Creates no domain table — it only enables the PostgreSQL extensions the
 * schema depends on, and exercises the full run/revert pipeline before any
 * entity exists. `pgcrypto` provides `gen_random_uuid()`, the project's
 * primary-key default.
 */
export class Baseline1789830817581 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS "pgcrypto"`);
  }
}
