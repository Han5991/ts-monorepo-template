import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlTaskRepository } from '#/infrastructure/persistence/sql-task-repository.ts';
import {
  migrated,
  SQL_BACKENDS,
  WARM_UP_TIMEOUT_MS,
} from '#/test/sql-backends.ts';

describe.each(SQL_BACKENDS)('SqlTaskRepository — $name', backend => {
  beforeAll(async () => {
    await backend.create();
  }, WARM_UP_TIMEOUT_MS);
  afterAll(backend.dispose);

  it('저장한 것을 id 오름차순으로 돌려주고, 상태로 거른다', async () => {
    const repo = new SqlTaskRepository(await migrated(backend));
    await repo.save({ id: 't2', title: '빨래', status: 'done' });
    await repo.save({ id: 't1', title: '장보기', status: 'todo' });
    expect((await repo.list({})).map(t => t.id)).toEqual(['t1', 't2']);
    expect(await repo.list({ status: 'done' })).toEqual([
      { id: 't2', title: '빨래', status: 'done' },
    ]);
  });

  it('같은 id로 다시 저장하면 덮어쓴다, 없는 id는 null', async () => {
    const repo = new SqlTaskRepository(await migrated(backend));
    await repo.save({ id: 't1', title: '장보기', status: 'todo' });
    await repo.save({ id: 't1', title: '장보기', status: 'done' });
    expect(await repo.get('t1')).toEqual({
      id: 't1',
      title: '장보기',
      status: 'done',
    });
    expect(await repo.get('t9')).toBeNull();
  });

  it('도메인 규칙에 어긋나는 값은 저장하지 않는다', async () => {
    const repo = new SqlTaskRepository(await migrated(backend));
    await expect(
      repo.save({ id: 't1', title: '   ', status: 'todo' }),
    ).rejects.toThrow();
    expect(await repo.list({})).toEqual([]);
  });
});
