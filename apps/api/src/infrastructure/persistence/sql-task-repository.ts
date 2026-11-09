import { TaskSchema, type Task } from '@app/domain';
import { z } from 'zod';
import type {
  TaskFilter,
  TaskRepository,
} from '#/application/ports/task-repository.ts';
import type { SqlClient } from '#/infrastructure/persistence/sql-client.ts';

const Rows = z.array(TaskSchema);
const COLUMNS = 'id, title, status';

export class SqlTaskRepository implements TaskRepository {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async list(filter: TaskFilter): Promise<Task[]> {
    const rows =
      filter.status === undefined
        ? await this.sql.query(`SELECT ${COLUMNS} FROM tasks ORDER BY id`)
        : await this.sql.query(
            `SELECT ${COLUMNS} FROM tasks WHERE status = $1 ORDER BY id`,
            [filter.status],
          );
    return Rows.parse(rows);
  }

  async get(id: string): Promise<Task | null> {
    const [task] = Rows.parse(
      await this.sql.query(`SELECT ${COLUMNS} FROM tasks WHERE id = $1`, [id]),
    );
    return task ?? null;
  }

  async save(task: Task): Promise<void> {
    const valid = TaskSchema.parse(task);
    // ON CONFLICT … DO UPDATE는 SQLite(3.24+)와 Postgres 양쪽 문법이다
    await this.sql.query(
      'INSERT INTO tasks (id, title, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET title = excluded.title, status = excluded.status',
      [valid.id, valid.title, valid.status],
    );
  }
}
