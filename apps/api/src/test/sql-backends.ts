import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '#/infrastructure/persistence/migrate.ts';
import { MIGRATIONS } from '#/infrastructure/persistence/migrations/index.ts';
import type { SqlClient } from '#/infrastructure/persistence/sql-client.ts';
import { PgliteSqlClient } from '#/test/pglite.ts';

export interface SqlBackend {
  name: string;
  /** 비어 있는 DB. 파일(모듈) 안에서 하나를 재사용하므로 이전에 받은 연결의 데이터는 지워진다 */
  create: () => Promise<SqlClient>;
  dispose: () => Promise<void>;
}

// 엔진을 띄우는 비용(PGlite WASM은 CI에서 수 초)이 커서 파일마다 한 번만 띄우고 테스트마다 비운다.
// 파일 안 테스트는 순차 실행이다. 실제로 쓸 DB를 정하면 그 어댑터를 여기 더해 같은 테스트를 그 위에서도 돌린다.

let pglite: PGlite | undefined;

const POSTGRES_BACKEND: SqlBackend = {
  name: 'Postgres(PGlite)',
  async create() {
    pglite ??= new PGlite();
    await pglite.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    return new PgliteSqlClient(pglite);
  },
  async dispose() {
    await pglite?.close();
    pglite = undefined;
  },
};

export const SQL_BACKENDS: readonly SqlBackend[] = [POSTGRES_BACKEND];

/** 엔진 기동은 한 번만 드는 비용이라 테스트 시간 밖(beforeAll)으로 뺀다 */
export const WARM_UP_TIMEOUT_MS = 60_000;

export async function migrated(backend: SqlBackend): Promise<SqlClient> {
  const sql = await backend.create();
  await applyMigrations(sql, MIGRATIONS);
  return sql;
}
