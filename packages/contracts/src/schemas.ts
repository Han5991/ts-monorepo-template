import { TASK_STATUSES } from '@app/domain';
import { z } from 'zod';

export const HealthSchema = z.object({ ok: z.literal(true) });

// 상태 값은 도메인 상수를 그대로 쓴다 — 단일 출처가 API·도메인 분리보다 중요하다(상태가 늘면 API도 같이 늘어야 맞다)
export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const TaskDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const TaskListDtoSchema = z.object({ tasks: z.array(TaskDtoSchema) });
export type TaskListDto = z.infer<typeof TaskListDtoSchema>;
