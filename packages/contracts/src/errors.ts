import { z } from 'zod';

export const API_ERROR_CODES = [
  'invalid_params',
  'not_found',
  'task_not_found',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 에러 코드 → HTTP 상태. 서버는 코드만 고르고 상태는 여기서 정해진다 */
export const API_ERROR_STATUS = {
  invalid_params: 400,
  not_found: 404,
  task_not_found: 404,
  internal: 500,
} as const satisfies Record<ApiErrorCode, number>;
export type ApiErrorStatus = (typeof API_ERROR_STATUS)[ApiErrorCode];

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
