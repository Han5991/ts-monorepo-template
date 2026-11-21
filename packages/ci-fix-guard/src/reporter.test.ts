import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseLedger, type Ledger } from '#/ledger.ts';
import { LEDGER_DIR_ENV } from '#/reporter.ts';

// 실제 Vitest로 보고서와 CLI를 돌린다 — Vitest를 올려 보고서 API가 바뀌면 verify에서 조용히 틀리기 전에 여기서 실패한다.
// verify 잡처럼 이 패키지(package.json과 src)를 node_modules 없는 곳에 복사해 그 판을 쓴다.

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const VITEST_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

/** 덧셈 코드(처음엔 틀렸다)와 그 테스트, 모드마다 하나씩 둔 테스트, 불러오기부터 실패하는 테스트 파일 */
const BUGGY_SUM = 'export const sum = (a: number, b: number) => a - b;\n';
const FIXED_SUM = 'export const sum = (a: number, b: number) => a + b;\n';
const SUM_TEST = [
  "import { sum } from './sum.ts';",
  "describe('sum', () => {",
  "  it('더한다', () => {",
  '    expect(sum(1, 2)).toBe(3);',
  '  });',
  '});',
  '',
].join('\n');
const FILES = {
  'sum.ts': BUGGY_SUM,
  'sum.test.ts': SUM_TEST,
  'modes.test.ts': [
    "describe('모드', () => {",
    "  it('통과', () => {});",
    "  it.skip('건너뜀', () => {});",
    "  it.todo('할 일');",
    "  it.fails('실패를 기대', () => {",
    '    expect(1).toBe(2);',
    '  });',
    "  it('옵션으로 실패를 기대', { fails: true }, () => {",
    '    expect(1).toBe(2);',
    '  });',
    "  it('실행 중에 건너뜀', ctx => {",
    '    ctx.skip();',
    '  });',
    '});',
    '',
  ].join('\n'),
  'broken.test.ts': "import './없는-파일.ts';\nit('돌지 못한다', () => {});\n",
};

let work = '';
let project = '';
let reporter = '';
let cli = '';

/** 픽스처 프로젝트에서 Vitest를 돌린다(전역 API로 — 픽스처에는 node_modules가 없다). 종료 코드를 돌려준다 */
function runVitest(ledgerDir: string | undefined): number {
  // 바깥 Vitest의 작업자 환경 변수가 안쪽 실행에 섞이지 않게 뺀다
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')),
  );
  const result = spawnSync(
    process.execPath,
    [
      VITEST_BIN,
      'run',
      '--root',
      project,
      '--globals',
      '--reporter=default',
      `--reporter=${reporter}`,
    ],
    {
      cwd: project,
      encoding: 'utf8',
      env:
        ledgerDir === undefined ? env : { ...env, [LEDGER_DIR_ENV]: ledgerDir },
    },
  );
  return result.status ?? -1;
}

function readLedger(dir: string): Ledger {
  const [name, ...rest] = readdirSync(dir);
  if (name === undefined || rest.length > 0) {
    throw new Error(`${dir}: 기록 파일이 하나여야 한다`);
  }
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  return parseLedger(raw, name);
}

/** 복사한 CLI를 저장소 루트(여기서는 픽스처 프로젝트)에서 돌린다 */
function runCli(before: string, after: string, patchedFiles: string[]) {
  const patch = path.join(work, `${path.basename(after)}.patch`);
  writeFileSync(
    patch,
    patchedFiles.map(file => `diff --git a/${file} b/${file}\n`).join(''),
  );
  const result = spawnSync(process.execPath, [cli, before, after, patch], {
    cwd: project,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout };
}

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), 'ci-fix-guard-'));
  const guard = path.join(work, 'guard');
  cpSync(
    path.join(PACKAGE_DIR, 'package.json'),
    path.join(guard, 'package.json'),
  );
  cpSync(path.join(PACKAGE_DIR, 'src'), path.join(guard, 'src'), {
    recursive: true,
  });
  reporter = path.join(guard, 'src', 'reporter.ts');
  cli = path.join(guard, 'src', 'cli.ts');
  project = path.join(work, 'project');
  mkdirSync(project);
  for (const [name, text] of Object.entries(FILES)) {
    writeFileSync(path.join(project, name), text);
  }
  runVitest(path.join(work, 'before'));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('보고서', () => {
  it('테스트마다 모드·결과·실패 기대를 적는다', () => {
    const modes = readLedger(path.join(work, 'before')).modules.find(module =>
      module.file.endsWith('modes.test.ts'),
    );
    expect(modes?.tests).toEqual([
      { name: '모드 > 통과', mode: 'run', fails: false, state: 'passed' },
      { name: '모드 > 건너뜀', mode: 'skip', fails: false, state: 'skipped' },
      { name: '모드 > 할 일', mode: 'todo', fails: false, state: 'skipped' },
      { name: '모드 > 실패를 기대', mode: 'run', fails: true, state: 'passed' },
      {
        name: '모드 > 옵션으로 실패를 기대',
        mode: 'run',
        fails: true,
        state: 'passed',
      },
      {
        name: '모드 > 실행 중에 건너뜀',
        mode: 'run',
        fails: false,
        state: 'skipped',
      },
    ]);
  });

  it('실패한 테스트와 불러오지 못한 파일, 실행 결과를 적는다', () => {
    const ledger = readLedger(path.join(work, 'before'));
    const byName = (name: string) =>
      ledger.modules.find(module => module.file.endsWith(name));
    expect(ledger.reason).toBe('failed');
    expect(ledger.root).toBe(project);
    expect(byName('sum.test.ts')?.tests).toEqual([
      { name: 'sum > 더한다', mode: 'run', fails: false, state: 'failed' },
    ]);
    expect(byName('broken.test.ts')).toMatchObject({ tests: [] });
    expect(byName('broken.test.ts')?.errors).toBeGreaterThan(0);
  });

  it('기록할 곳을 받지 못하면 실행이 실패한다', () => {
    writeFileSync(path.join(project, 'sum.ts'), FIXED_SUM);
    rmSync(path.join(project, 'broken.test.ts'));
    try {
      expect(runVitest(undefined)).not.toBe(0);
    } finally {
      writeFileSync(path.join(project, 'sum.ts'), BUGGY_SUM);
      writeFileSync(
        path.join(project, 'broken.test.ts'),
        FILES['broken.test.ts'],
      );
    }
  });
});

describe('CLI(작업 트리 밖에 복사한 판)', () => {
  it('코드를 고쳐 실패한 테스트를 통과시킨 패치는 통과한다', () => {
    writeFileSync(path.join(project, 'sum.ts'), FIXED_SUM);
    try {
      runVitest(path.join(work, 'fixed'));
      expect(
        runCli(path.join(work, 'before'), path.join(work, 'fixed'), ['sum.ts']),
      ).toEqual({
        status: 0,
        stdout:
          '통과: 패치 전에 돌던 테스트가 모두 돌고, 실패한 테스트가 든 파일은 고치지 않았다\n',
      });
    } finally {
      writeFileSync(path.join(project, 'sum.ts'), BUGGY_SUM);
    }
  });

  it('실패한 테스트를 꺼서 초록으로 만든 패치는 거부한다 — 문자열 검사가 못 보는 꼴(.call)도', () => {
    writeFileSync(
      path.join(project, 'sum.test.ts'),
      SUM_TEST.replace(
        "it('더한다', () => {",
        "it('더한다', ctx => {\n    ctx.skip.call(ctx, true);",
      ),
    );
    try {
      runVitest(path.join(work, 'skipped'));
      const { status, stdout } = runCli(
        path.join(work, 'before'),
        path.join(work, 'skipped'),
        ['sum.test.ts'],
      );
      expect(status).toBe(1);
      expect(stdout).toBe(
        '거부: sum.test.ts > sum > 더한다 — 실행 중에 건너뛴다(ctx.skip 등) 외 1건\n',
      );
    } finally {
      writeFileSync(path.join(project, 'sum.test.ts'), SUM_TEST);
    }
  });
});
