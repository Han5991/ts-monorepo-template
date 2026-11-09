import { describe, expect, it } from 'vitest';
import { createTaskQueries } from '#/application/use-cases/task-queries.ts';
import { InMemoryTaskRepository } from '#/infrastructure/memory/in-memory-task-repository.ts';
import { createHttpApp } from '#/interface/http/app.ts';

const app = createHttpApp({
  tasks: createTaskQueries(
    new InMemoryTaskRepository([
      { id: 't1', title: '장보기', status: 'todo' },
      { id: 't2', title: '빨래', status: 'done' },
    ]),
  ),
});

const get = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as unknown };
};

describe('HTTP API', () => {
  it('GET /api/health', async () => {
    expect(await get('/api/health')).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('GET /api/v1/tasks — 쿼리로 상태를 거른다', async () => {
    expect((await get('/api/v1/tasks')).body).toEqual({
      tasks: [
        { id: 't1', title: '장보기', status: 'todo' },
        { id: 't2', title: '빨래', status: 'done' },
      ],
    });
    expect((await get('/api/v1/tasks?status=done')).body).toEqual({
      tasks: [{ id: 't2', title: '빨래', status: 'done' }],
    });
  });

  it('계약에 맞지 않는 파라미터는 400 invalid_params', async () => {
    expect(await get('/api/v1/tasks?status=archived')).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_params' } },
    });
  });

  it('없는 할 일은 404 task_not_found, 없는 경로는 404 not_found', async () => {
    expect(await get('/api/v1/tasks/t9')).toMatchObject({
      status: 404,
      body: { error: { code: 'task_not_found' } },
    });
    expect(await get('/api/v1/nope')).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });
});
