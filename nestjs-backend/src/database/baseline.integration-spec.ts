import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';

/**
 * Exercises the baseline migration against the real database.
 *
 * Uses `dataSourceOptions` unmodified, including its migrations glob, so the
 * suite validates the configuration production actually runs with rather than
 * a substitute assembled for the test.
 */
describe('Baseline migration (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(dataSourceOptions);
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Leave the schema as other suites expect to find it.
      await dataSource.runMigrations();
      await dataSource.destroy();
    }
  });

  it('enables the pgcrypto extension', async () => {
    const rows = await dataSource.query<{ extname: string }[]>(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`,
    );

    expect(rows).toHaveLength(1);
  });

  it('makes gen_random_uuid() return a valid UUID', async () => {
    const [{ id }] = await dataSource.query<{ id: string }[]>(
      'SELECT gen_random_uuid() AS id',
    );

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('records the migration in the migrations control table', async () => {
    const rows = await dataSource.query<{ name: string }[]>(
      `SELECT name FROM migrations WHERE name = 'Baseline1789830817581'`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('is reversible — revert drops the extension, re-run restores it', async () => {
    await dataSource.undoLastMigration();

    const afterRevert = await dataSource.query<{ extname: string }[]>(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`,
    );
    expect(afterRevert).toHaveLength(0);

    await dataSource.runMigrations();

    const afterRerun = await dataSource.query<{ extname: string }[]>(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`,
    );
    expect(afterRerun).toHaveLength(1);
  });
});
