import * as Joi from 'joi';

/**
 * Environment validation schema, applied by ConfigModule at boot.
 *
 * Every variable without a safe default is `required()`: the application must
 * refuse to start on a misconfigured environment rather than boot and fail
 * later, mid-request, with an opaque connection error.
 */
/** Shape of the environment after Joi has validated and coerced it. */
export interface ValidatedEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  CORS_ORIGIN: string;
}

export const validationSchema = Joi.object<ValidatedEnv, true>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  CORS_ORIGIN: Joi.string().required(),
});
