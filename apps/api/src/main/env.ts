import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
});

export interface Env {
  port: number;
}

/** 환경 변수는 바깥 입력이다 — 시작할 때 한 번 검증하고, 틀리면 서버를 띄우지 않는다 */
export function readEnv(
  source: Readonly<Record<string, string | undefined>>,
): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`환경 변수 오류 — ${z.prettifyError(parsed.error)}`);
  }
  return { port: parsed.data.PORT };
}
