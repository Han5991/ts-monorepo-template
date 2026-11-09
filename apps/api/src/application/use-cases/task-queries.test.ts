import { describe, expect, it } from 'vitest';
import { createTaskQueries } from '#/application/use-cases/task-queries.ts';
import { InMemoryTaskRepository } from '#/infrastructure/memory/in-memory-task-repository.ts';

const queries = createTaskQueries(
  new InMemoryTaskRepository([
    { id: 't2', title: '빨래', status: 'done' },
    { id: 't1', title: '장보기', status: 'todo' },
  ]),
);

describe('createTaskQueries', () => {
  it('상태를 주지 않으면 전부, 주면 그 상태만 — id 오름차순', async () => {
    expect((await queries.list(undefined)).map(t => t.id)).toEqual([
      't1',
      't2',
    ]);
    expect((await queries.list('done')).map(t => t.id)).toEqual(['t2']);
  });

  it('없는 id는 null', async () => {
    expect(await queries.get('t9')).toBeNull();
  });
});
