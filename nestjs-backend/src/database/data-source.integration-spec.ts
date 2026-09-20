import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';

describe('AppDataSource (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // A dedicated instance per suite: the exported singleton is owned by the
    // TypeORM CLI and must not be initialized/destroyed by tests.
    dataSource = new DataSource(dataSourceOptions);
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('connects to the db service and runs a trivial query', async () => {
    const result =
      await dataSource.query<{ value: number }[]>('SELECT 1 AS value');

    expect(result).toEqual([{ value: 1 }]);
  });

  it('resolves the host to the compose service name, not localhost', () => {
    expect(dataSource.options).toMatchObject({ host: 'db' });
  });

  it('reports synchronize: false even in development', () => {
    expect(process.env.NODE_ENV).toBe('development');
    expect(dataSource.options.synchronize).toBe(false);
  });

  it('fails fast with an explicit error when the host is unreachable', async () => {
    const broken = new DataSource({
      ...dataSourceOptions,
      host: 'nonexistent-db-host',
      // Keep the failure quick and bounded so the suite cannot hang.
      connectTimeoutMS: 5000,
    });

    await expect(broken.initialize()).rejects.toThrow();
    expect(broken.isInitialized).toBe(false);
  }, 20000);
});
