---
title: Migration Workflow
impact: HIGH
impactDescription: Using synchronize in production causes data loss; skipping migrations leads to schema drift
tags: migration, cli, synchronize, production, workflow
---

## Migration Workflow

**Impact: HIGH (synchronize in production causes data loss; skipping migrations leads to schema drift)**

Always use migrations for schema changes. Never use `synchronize: true` in any environment.

**Incorrect (using synchronize instead of migrations):**

```typescript
// data-source.ts
export const AppDataSource = new DataSource({
  // ...
  synchronize: true, // DANGEROUS: drops columns/tables to match entities
});
```

**Correct (migration-based workflow):**

```typescript
// data-source.ts
export const AppDataSource = new DataSource({
  // ...
  synchronize: false, // false in EVERY environment — see project rule below
  migrations: ["src/migrations/**/*.ts"],
});
```

### CLI Commands

```bash
# Generate migration from entity changes (compares entities vs current schema)
npx typeorm migration:generate src/migrations/CreateUsers -d src/data-source.ts

# Create empty migration (for custom SQL, seeds, data migrations)
npx typeorm migration:create src/migrations/SeedUsers

# Run pending migrations
npx typeorm migration:run -d src/data-source.ts

# Revert last migration
npx typeorm migration:revert -d src/data-source.ts
```

### Workflow

1. Modify entity (add/change columns, relations)
2. Run `migration:generate` to auto-generate the migration
3. Review the generated SQL — never blindly run generated migrations
4. Run `migration:run` to apply
5. Commit both the entity change and the migration file together

**Key points:**
- `synchronize` is **hardcoded `false` in every environment** — development, test and production alike. This project rule is defined in `.claude/rules/typeorm-migrations.md` and **prevails over** the canonical TypeORM/NestJS examples, which enable `synchronize` in development.
- Do **not** make `synchronize` environment-conditional and do **not** expose it as an env var: there is no `DB_SYNCHRONIZE` in this project. A literal `false` cannot be flipped by a misconfigured environment.
- Rationale: `synchronize: true` in development produces tables with no migration backing them, so the schema on a developer machine silently drifts from what migrations actually build in production — the drift is only discovered at deploy time. Migrations are the single sanctioned path for schema change.
- Use `migration:generate` for schema changes, `migration:create` for data/seed migrations
- Always review generated migrations before running them
- Commit entity changes and migration files in the same commit
- In CI/CD, run `migration:run` as part of the deployment pipeline

Reference: [TypeORM Migrations](https://typeorm.io/migrations)
