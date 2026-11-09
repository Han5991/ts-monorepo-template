import { z } from 'zod';
import type { Migration } from '#/infrastructure/persistence/migrations/index.ts';
import type { SqlClient } from '#/infrastructure/persistence/sql-client.ts';

async function appliedNames(sql: SqlClient): Promise<Set<string>> {
  await sql.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  return new Set(
    z
      .array(z.object({ name: z.string() }))
      .parse(await sql.query('SELECT name FROM schema_migrations'))
      .map(r => r.name),
  );
}

/** 아직 적용하지 않은 마이그레이션 이름(적용 순서대로) */
export async function pendingMigrations(
  sql: SqlClient,
  migrations: readonly Migration[],
): Promise<string[]> {
  const done = await appliedNames(sql);
  return migrations.filter(m => !done.has(m.name)).map(m => m.name);
}

export async function applyMigrations(
  sql: SqlClient,
  migrations: readonly Migration[],
): Promise<string[]> {
  const done = await appliedNames(sql);

  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await sql.batch([
      ...m.statements.map(text => ({ text })),
      {
        text: 'INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)',
        params: [m.name, new Date().toISOString()],
      },
    ]);
    applied.push(m.name);
  }
  return applied;
}
