import { registerAs } from '@nestjs/config';

/**
 * Database namespace. Consumed via `ConfigType<typeof databaseConfig>` so no
 * module has to reach into `process.env` directly.
 */
export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST as string,
  port: parseInt(process.env.DB_PORT as string, 10),
  username: process.env.DB_USERNAME as string,
  password: process.env.DB_PASSWORD as string,
  name: process.env.DB_NAME as string,
}));
