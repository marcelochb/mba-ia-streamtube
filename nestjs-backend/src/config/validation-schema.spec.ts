import * as Joi from 'joi';
import { validationSchema, type ValidatedEnv } from './validation.schema';

/** A complete, valid environment; individual tests mutate a copy of it. */
const validEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  DB_HOST: 'db',
  DB_PORT: '5432',
  DB_USERNAME: 'streamtube',
  DB_PASSWORD: 'streamtube_local_dev',
  DB_NAME: 'streamtube',
  CORS_ORIGIN: 'http://localhost:3001',
};

/** Mirrors the options ConfigModule passes to Joi in app.module.ts. */
const validate = (
  env: Record<string, unknown>,
): { error?: Joi.ValidationError; value: ValidatedEnv } =>
  validationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
  });

describe('validationSchema', () => {
  it('accepts a complete environment', () => {
    const { error } = validate(validEnv);

    expect(error).toBeUndefined();
  });

  it('coerces numeric variables to numbers', () => {
    const { value } = validate(validEnv);

    expect(value.PORT).toBe(3000);
    expect(value.DB_PORT).toBe(5432);
  });

  it.each(['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME', 'CORS_ORIGIN'])(
    'rejects a missing %s',
    (key) => {
      const env = { ...validEnv };
      delete env[key as keyof typeof validEnv];

      const { error } = validate(env);

      expect(error).toBeDefined();
      expect(error?.message).toContain(key);
    },
  );

  it('rejects a NODE_ENV outside the allowed set', () => {
    const { error } = validate({ ...validEnv, NODE_ENV: 'staging' });

    expect(error).toBeDefined();
    expect(error?.message).toContain('NODE_ENV');
  });

  it('rejects a non-numeric port', () => {
    const { error } = validate({ ...validEnv, PORT: 'not-a-number' });

    expect(error).toBeDefined();
    expect(error?.message).toContain('PORT');
  });

  it('reports every invalid variable at once, not just the first', () => {
    const env = { ...validEnv, NODE_ENV: 'staging' };
    delete (env as Partial<typeof validEnv>).DB_PASSWORD;
    delete (env as Partial<typeof validEnv>).DB_NAME;

    const { error } = validate(env);

    // abortEarly: false is what makes a misconfigured .env fixable in one pass
    // instead of one boot attempt per missing variable.
    expect(error?.details).toHaveLength(3);
    expect(error?.message).toContain('NODE_ENV');
    expect(error?.message).toContain('DB_PASSWORD');
    expect(error?.message).toContain('DB_NAME');
  });

  it('applies defaults for the variables that have a safe one', () => {
    const env = { ...validEnv };
    delete (env as Partial<typeof validEnv>).NODE_ENV;
    delete (env as Partial<typeof validEnv>).PORT;
    delete (env as Partial<typeof validEnv>).DB_PORT;

    const { error, value } = validate(env);

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.DB_PORT).toBe(5432);
  });
});
