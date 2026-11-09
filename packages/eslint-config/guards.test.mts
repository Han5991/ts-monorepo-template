import { existsSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// lint 설정이 실제로 막는지 확인한다. 규칙을 지우거나 풀면(예외를 넓히면) 여기서 실패한다 —
// "설정에 적혀 있다"가 아니라 "위반을 넣으면 오류가 난다"를 증명한다.
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const eslint = new ESLint({ cwd: ROOT });

/** 저장소 안의 (없는) 파일 경로로 코드를 lint한다 — 그 경로에 가장 가까운 eslint.config.mts가 적용된다 */
async function ruleIds(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, file),
  });
  if (!result) throw new Error(`lint 결과가 없다: ${file}`);
  return result.messages
    .filter(m => m.severity === 2)
    .map(m => m.ruleId ?? `(fatal) ${m.message}`);
}

const DOMAIN = 'packages/domain/src/task/probe.ts';

describe('도메인', () => {
  it('양성 대조 — 깨끗한 코드는 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        "import { z } from 'zod';\nexport const Id = z.string();\n",
      ),
    ).toEqual([]);
  });

  it('도메인 모듈을 공개 API(index.ts)를 거치지 않고 import하면 막힌다', async () => {
    expect(
      await ruleIds(
        'packages/domain/src/probe.ts',
        "import { nextStatus } from '#/task/task.ts';\nexport const n = nextStatus;\n",
      ),
    ).toContain('boundaries/dependencies');
  });

  it('도메인은 Node 전용 모듈을 쓰지 못한다', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
      ),
    ).toContain('no-restricted-imports');
  });

  it('인라인 eslint-disable은 효과가 없고, 주석 자체가 오류다', async () => {
    const ids = await ruleIds(
      DOMAIN,
      '// eslint-disable-next-line eqeqeq\nexport const same = (a: number, b: number) => a == b;\n',
    );
    expect(ids).toContain('eqeqeq');
    expect(ids).toContain('@eslint-community/eslint-comments/no-use');
  });

  it('상대 경로 import는 막힌다 — #/ 별칭이나 패키지 이름으로', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        "import { TASK_STATUSES } from './task.ts';\nexport const s = TASK_STATUSES;\n",
      ),
    ).toContain('no-restricted-imports');
  });
});

// init에서 api 모듈을 빼면 앱이 없으니 건너뛴다
const USE_CASE = 'apps/api/src/application/use-cases/probe.ts';

describe.skipIf(!existsSync(path.join(ROOT, 'apps/api/package.json')))(
  'API 앱',
  () => {
    it('양성 대조 — 깨끗한 코드는 통과한다', async () => {
      expect(
        await ruleIds(
          USE_CASE,
          "import type { Task } from '@app/domain';\nexport const ids = (tasks: Task[]) => tasks.map(t => t.id);\n",
        ),
      ).toEqual([]);
    });

    it.each([
      [
        '애플리케이션이 HTTP 프레임워크를',
        USE_CASE,
        "import { Hono } from 'hono';\nexport const app = new Hono();\n",
      ],
      [
        '애플리케이션이 인프라를',
        USE_CASE,
        "import { InMemoryTaskRepository } from '#/infrastructure/memory/in-memory-task-repository.ts';\nexport const r = InMemoryTaskRepository;\n",
      ],
      [
        '도메인이 계약을',
        DOMAIN,
        "import { ENDPOINTS } from '@app/contracts';\nexport const e = ENDPOINTS;\n",
      ],
    ])('%s import하면 막힌다', async (_, file, code) => {
      expect(await ruleIds(file, code)).toContain('boundaries/dependencies');
    });
  },
);
