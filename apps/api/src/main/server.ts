import { serve } from '@hono/node-server';
import type { Task } from '@app/domain';
import { createTaskQueries } from '#/application/use-cases/task-queries.ts';
import { InMemoryTaskRepository } from '#/infrastructure/memory/in-memory-task-repository.ts';
import { createHttpApp } from '#/interface/http/app.ts';
import { readEnv } from '#/main/env.ts';

// 조립 지점. 저장소 구현·실행 환경을 고르는 곳은 여기 하나다 — 실제 DB를 정하면
// SqlClient 어댑터를 만들어 InMemoryTaskRepository 대신 SqlTaskRepository를 넘긴다.
const SAMPLE_TASKS: readonly Task[] = [
  { id: 't1', title: '템플릿으로 저장소 만들기', status: 'done' },
  {
    id: 't2',
    title: '`pnpm init:project <이름>`으로 이름 바꾸기',
    status: 'doing',
  },
  {
    id: 't3',
    title: '예시 도메인(task)을 내 도메인으로 바꾸기',
    status: 'todo',
  },
];

const env = readEnv(process.env);
const app = createHttpApp({
  tasks: createTaskQueries(new InMemoryTaskRepository(SAMPLE_TASKS)),
});

serve({ fetch: app.fetch, port: env.port }, info => {
  console.log(`API: http://localhost:${String(info.port)}/api/health`);
});
