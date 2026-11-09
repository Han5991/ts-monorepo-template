import type { Task, TaskStatus } from '@app/domain';
import type { TaskRepository } from '#/application/ports/task-repository.ts';

export function createTaskQueries(repository: TaskRepository) {
  return {
    list: (status: TaskStatus | undefined): Promise<Task[]> =>
      repository.list(status === undefined ? {} : { status }),
    get: (id: string): Promise<Task | null> => repository.get(id),
  };
}

export type TaskQueries = ReturnType<typeof createTaskQueries>;
