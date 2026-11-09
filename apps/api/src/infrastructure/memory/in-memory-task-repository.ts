import type { Task } from '@app/domain';
import type {
  TaskFilter,
  TaskRepository,
} from '#/application/ports/task-repository.ts';

/** 프로세스 메모리에 둔다 — 개발 서버와 유스케이스 테스트용. 재시작하면 사라진다 */
export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  constructor(initial: readonly Task[] = []) {
    for (const task of initial) this.tasks.set(task.id, task);
  }

  async list(filter: TaskFilter): Promise<Task[]> {
    return [...this.tasks.values()]
      .filter(t => filter.status === undefined || t.status === filter.status)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }
}
