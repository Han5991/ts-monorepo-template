import type { PGlite } from '@electric-sql/pglite';
import type {
  SqlClient,
  SqlParam,
  SqlRow,
  SqlStatement,
} from '#/infrastructure/persistence/sql-client.ts';

/** Postgres 방언 검증용 — 프로세스 안에서 Postgres를 띄워 같은 SQL이 도는지 매번 확인한다 */
export class PgliteSqlClient implements SqlClient {
  private readonly db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  async query(text: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    return (await this.db.query<SqlRow>(text, params)).rows;
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    await this.db.transaction(async tx => {
      for (const s of statements) await tx.query(s.text, s.params ?? []);
    });
  }
}
