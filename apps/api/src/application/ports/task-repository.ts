import type { Task, TaskStatus } from '@app/domain';

export interface TaskFilter {
  status?: TaskStatus;
}

/** 할 일 저장소. 구현은 infrastructure에 있고, 어떤 것을 쓸지는 main이 고른다 */
export interface TaskRepository {
  /** id 오름차순 */
  list(filter: TaskFilter): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  save(task: Task): Promise<void>;
}
