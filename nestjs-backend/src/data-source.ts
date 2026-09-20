import { readFileSync } from 'node:fs';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

/**
 * Production TLS options.
 *
 * `rejectUnauthorized` stays `true`: disabling it makes the driver accept any
 * certificate, which turns the database connection into a trivial MITM target
 * for credentials and query traffic. When a private CA is used, point
 * `DB_SSL_CA_PATH` at its bundle.
 */
const buildSslOptions = (): PostgresConnectionOptions['ssl'] => {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  const caPath = process.env.DB_SSL_CA_PATH;

  return {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
  };
};

export const dataSourceOptions: PostgresConnectionOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  // src/migrations/ holds migrations and nothing else: TypeORM imports and
  // runs whatever this glob matches, so a stray file there would be executed.
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',

  // Never true, in any environment. Schema changes reach the database only
  // through a migration — see .claude/rules/typeorm-migrations.md.
  synchronize: false,

  logging:
    process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  poolSize: 10,
  ssl: buildSslOptions(),
};

/** DataSource instance consumed by the TypeORM CLI (`-d src/data-source.ts`). */
export const AppDataSource = new DataSource(dataSourceOptions);
