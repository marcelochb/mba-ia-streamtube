import { registerAs } from '@nestjs/config';

/**
 * Application namespace. `corsOrigin` is always an explicit allow-list —
 * a wildcard origin is never produced here.
 */
export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV as 'development' | 'test' | 'production',
  port: parseInt(process.env.PORT as string, 10),
  corsOrigin: (process.env.CORS_ORIGIN as string)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
}));
