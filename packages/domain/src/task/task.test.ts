import { describe, expect, it } from 'vitest';
import { countByStatus, isDone, nextStatus, TaskSchema } from '#/task/task.ts';

describe('isDone', () => {
  it('done만 끝난 것이다', () => {
    const statuses = ['todo', 'doing', 'done'];
    expect(isDone({ status: 'done' })).toBe(true);
    expect(isDone({ status: 'doing' })).toBe(false);
    expect(isDone({ status: 'todo' })).toBe(false);
  });
});

describe('nextStatus', () => {
  it('todo → doing → done으로 나아가고, done은 그대로다', () => {
    expect(nextStatus('todo')).toBe('doing');
    expect(nextStatus('doing')).toBe('done');
    expect(nextStatus('done')).toBe('done');
  });
});

describe('countByStatus', () => {
  it('상태마다 개수를 센다 — 없는 상태도 0으로 나온다', () => {
    expect(countByStatus([{ status: 'todo' }, { status: 'todo' }])).toEqual({
      todo: 2,
      doing: 0,
      done: 0,
    });
  });
});

describe('TaskSchema', () => {
  it('제목 앞뒤 공백을 지우고, 비었거나 200자를 넘으면 거부한다', () => {
    expect(
      TaskSchema.parse({ id: 't1', title: '  씻기 ', status: 'todo' }).title,
    ).toBe('씻기');
    for (const title of ['   ', 'x'.repeat(201)]) {
      expect(
        TaskSchema.safeParse({ id: 't1', title, status: 'todo' }).success,
      ).toBe(false);
    }
  });
});
