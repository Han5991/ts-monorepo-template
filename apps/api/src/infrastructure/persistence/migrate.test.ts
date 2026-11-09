import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  pendingMigrations,
} from '#/infrastructure/persistence/migrate.ts';
import { MIGRATIONS } from '#/infrastructure/persistence/migrations/index.ts';
import {
  migrated,
  SQL_BACKENDS,
  WARM_UP_TIMEOUT_MS,
} from '#/test/sql-backends.ts';

describe.each(SQL_BACKENDS)('applyMigrations — $name', backend => {
  beforeAll(async () => {
    await backend.create();
  }, WARM_UP_TIMEOUT_MS);
  afterAll(backend.dispose);

  it('빈 DB에 적용하면 적용 기록이 남는다', async () => {
    const sql = await migrated(backend);
    expect(
      await sql.query('SELECT name FROM schema_migrations ORDER BY name'),
    ).toEqual(MIGRATIONS.map(m => ({ name: m.name })));
  });

  it('이미 적용한 마이그레이션은 다시 실행하지 않는다', async () => {
    const sql = await migrated(backend);
    const extra = [
      { name: '0001-tasks', statements: ['SELECT 1'] },
      { name: '9999-probe', statements: ['CREATE TABLE probe (id INTEGER)'] },
    ];
    expect(await applyMigrations(sql, extra)).toEqual(['9999-probe']);
    expect(await applyMigrations(sql, extra)).toEqual([]);
  });

  it('실패한 마이그레이션은 기록되지 않고 그 변경도 남지 않는다', async () => {
    const sql = await migrated(backend);
    await expect(
      applyMigrations(sql, [
        {
          name: '9999-broken',
          statements: ['CREATE TABLE half (id INTEGER)', 'SELECT * FROM nope'],
        },
      ]),
    ).rejects.toThrow();
    expect(
      await sql.query('SELECT name FROM schema_migrations WHERE name = $1', [
        '9999-broken',
      ]),
    ).toEqual([]);
    await expect(sql.query('SELECT * FROM half')).rejects.toThrow();
  });

  it('pendingMigrations는 아직 적용하지 않은 것만 순서대로 돌려준다', async () => {
    const sql = await backend.create();
    expect(await pendingMigrations(sql, MIGRATIONS)).toEqual(
      MIGRATIONS.map(m => m.name),
    );
    await applyMigrations(sql, MIGRATIONS);
    expect(await pendingMigrations(sql, MIGRATIONS)).toEqual([]);
  });
});
