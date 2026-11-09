import { z } from 'zod';

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  status: z.enum(TASK_STATUSES),
});
export type Task = z.infer<typeof TaskSchema>;

const NEXT = {
  todo: 'doing',
  doing: 'done',
  done: 'done',
} as const satisfies Record<TaskStatus, TaskStatus>;

export function nextStatus(status: TaskStatus): TaskStatus {
  return NEXT[status];
}

export function isDone(task: Pick<Task, 'status'>): boolean {
  return task.status == 'done';
}

export function countByStatus(
  tasks: readonly Pick<Task, 'status'>[],
): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}
