import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { moduleFolderProblems } from '@app/eslint-config';
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

  // 패키지가 sideEffects: false라 번들러가 쓰지 않는 모듈을 통째로 버린다 — 불러올 때 도는 코드가 있으면 조용히 사라진다(ADR 0011)
  it.each([
    ['함수 호출', 'console.log(1);\nexport const a = 1;\n'],
    [
      'if 문',
      'if (Date.now() > 0) {\n  globalThis.name = "x";\n}\nexport const a = 1;\n',
    ],
    ['내보내는 클래스', 'export class Registry {}\n'],
    [
      'static 블록이 있는 클래스 식',
      'export const R = class {\n  static {\n    globalThis.name = "x";\n  }\n};\n',
    ],
    [
      '즉시 실행 함수로 만든 상수',
      'export const y = (() => {\n  globalThis.name = "x";\n  return 1;\n})();\n',
    ],
    ['내보내는 enum', 'export enum Kind {\n  A,\n}\n'],
    ['기본으로 내보내는 식', 'export default [1, 2].map(n => n * 2);\n'],
  ])('도메인 모듈에 둔 %s — 막힌다', async (_, code) => {
    expect(await ruleIds(DOMAIN, code)).toContain('no-restricted-syntax');
  });

  // 오버로드 시그니처는 공통 규칙이 막는다(ADR 0020) — 여기서는 함수 선언만 본다
  it('양성 대조 — 선언(상수·함수·기본 내보내기 함수·타입·전역 타입·다시 내보내기)은 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        [
          'export function f(a: string | number) {',
          '  return a;',
          '}',
          'export default function g() {',
          '  return 1;',
          '}',
          'export const seen = new Map<string, number>();',
          'export const doubled = [1, 2].map(n => n * 2);',
          'export type Id = string;',
          'declare global {',
          '  interface Window {',
          '    probe?: string;',
          '  }',
          '}',
          "export { nextStatus } from '#/task/task.ts';",
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});

// 공통 규칙(base)이라 어느 패키지에서나 같다 — 타입 오류를 고치는 대신 덮는 문법은 막힌다(ADR 0016)
describe('타입 오류를 덮는 문법', () => {
  const ASSERTION = '@typescript-eslint/consistent-type-assertions';
  const TS_COMMENT = '@typescript-eslint/ban-ts-comment';
  const AS_NUMBER = 'export const n = (x: unknown) => x as number;\n';

  it.each([
    ['as 단언', AS_NUMBER, ASSERTION],
    ['꺾쇠 단언', 'export const n = (x: unknown) => <number>x;\n', ASSERTION],
    [
      'non-null 단언(!)',
      'export const first = (list: number[]) => list[0]!;\n',
      '@typescript-eslint/no-non-null-assertion',
    ],
    [
      '설명을 붙인 @ts-expect-error',
      "// @ts-expect-error 이유를 적어도 막힌다\nexport const a: number = 'x';\n",
      TS_COMMENT,
    ],
    // 바꾼 옵션은 @ts-expect-error 하나다 — 나머지 옵션이 규칙 기본값에서 함께 풀리지 않았는지 본다
    [
      '@ts-ignore',
      "// @ts-ignore 이유를 적어도 막힌다\nexport const a: number = 'x';\n",
      TS_COMMENT,
    ],
    [
      '@ts-nocheck',
      "// @ts-nocheck 이유를 적어도 막힌다\nexport const a: number = 'x';\n",
      TS_COMMENT,
    ],
  ])('%s — 막힌다', async (_, code, rule) => {
    expect(await ruleIds(DOMAIN, code)).toContain(rule);
  });

  it('테스트 파일에서도 막힌다', async () => {
    expect(
      await ruleIds('packages/domain/src/task/probe.test.ts', AS_NUMBER),
    ).toContain(ASSERTION);
  });

  it('양성 대조 — as const와 satisfies는 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        [
          "export const STATUSES = ['todo', 'done'] as const;",
          'export const LIMITS = { title: 80 } satisfies Record<string, number>;',
          "export const LABELS = { todo: '할 일' } as const satisfies Record<",
          '  string,',
          '  string',
          '>;',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});

// 공통 규칙(base)이라 어느 패키지에서나 같다 — 컴파일러가 확인하지 않는 타입 주장도 막힌다(ADR 0018·0020).
// 매개변수는 `_x`로 쓴다 — 오늘 다른 규칙을 모두 통과하는 우회 꼴을 그대로 넣는다(`x`로 쓰면 no-unused-vars도 함께 걸린다)
describe('컴파일러가 확인하지 않는 타입 주장', () => {
  const PREDICATE = 'local/no-type-predicate';
  const DEFINITE = 'local/no-definite-assignment-assertion';
  const DECLARE_FIELD = 'local/no-declare-field';
  const OVERLOAD = 'local/no-overload-signature';
  const AMBIENT = 'local/no-ambient-value';
  const DECLARATION_FILE = 'local/no-declaration-file';
  // 있는 테스트 파일의 경로로 넣는다 — 그 내용 대신 탐침 코드를 lint한다
  const DOMAIN_TEST = 'packages/domain/src/task/task.test.ts';
  const TRUE_GUARD =
    'export const isText = (_x: unknown): _x is string => true;\n';

  it.each([
    ['참만 돌려주는 가드', TRUE_GUARD, PREDICATE],
    [
      '블록 본문의 가드',
      'export const isText = (_x: unknown): _x is string => {\n  return true;\n};\n',
      PREDICATE,
    ],
    [
      '함수 선언의 가드',
      'export function isText(_x: unknown): _x is string {\n  return true;\n}\n',
      PREDICATE,
    ],
    // 오버로드는 구현과 느슨하게만 맞춰 본다 — 서술은 오버로드에 두고 구현은 boolean이어도 컴파일된다
    [
      '서술을 붙인 오버로드',
      'export function isText(x: unknown): x is string;\nexport function isText(_x: unknown): boolean {\n  return true;\n}\n',
      PREDICATE,
    ],
    [
      'declare function의 서술',
      'export declare function isText(x: unknown): x is string;\n',
      PREDICATE,
    ],
    // 단언 시그니처는 본문이 던지는지도 보지 않는다 — 빈 본문도 컴파일된다
    [
      '본문이 빈 asserts x is T',
      'export function trust(_x: unknown): asserts _x is string {}\n',
      PREDICATE,
    ],
    [
      '본문이 빈 asserts x',
      'export function ok(_c: unknown): asserts _c {}\n',
      PREDICATE,
    ],
    [
      'this is T',
      'export interface Shape {\n  isRound(): this is { r: number };\n}\n',
      PREDICATE,
    ],
    [
      '타입 별칭의 서술',
      'export type Guard = (x: unknown) => x is string;\n',
      PREDICATE,
    ],
    ['변수의 확정 대입(let x!: T)', 'export let n!: number;\n', DEFINITE],
    [
      '필드의 확정 대입(x!: T)',
      'export class Box {\n  n!: number;\n}\n',
      DEFINITE,
    ],
    [
      'accessor 필드의 확정 대입',
      'export class Box {\n  accessor n!: number;\n}\n',
      DEFINITE,
    ],
    [
      'declare 필드',
      'export class Box {\n  declare n: number;\n}\n',
      DECLARE_FIELD,
    ],
    // 오버로드는 구현과 느슨하게만 맞춰 본다 — unknown을 돌려주는 구현에 다른 타입을 돌려주는 오버로드가 컴파일된다
    [
      '함수 오버로드',
      'export function parse(x: string): { a: string };\nexport function parse(x: unknown): unknown {\n  return x;\n}\n',
      OVERLOAD,
    ],
    [
      '메서드 오버로드',
      'export class Box {\n  get(x: string): { a: string };\n  get(x: unknown): unknown {\n    return x;\n  }\n}\n',
      OVERLOAD,
    ],
    ['declare const', 'export declare const config: { a: string };\n', AMBIENT],
    [
      'declare function',
      'export declare function parse(x: unknown): { a: string };\n',
      AMBIENT,
    ],
    [
      'declare class',
      'export declare class Ext {\n  read(): string;\n}\n',
      AMBIENT,
    ],
    ['declare enum', 'export declare enum Kind {\n  A,\n}\n', AMBIENT],
    // lib 함수에 오버로드를 더한다 — parseInt(1)이 { a: string }으로 컴파일된다
    [
      'declare global 안의 함수',
      'declare global {\n  function parseInt(x: unknown): { a: string };\n}\nexport {};\n',
      AMBIENT,
    ],
    [
      'declare module 안의 값',
      "declare module 'virtual:probe' {\n  const src: string;\n  export default src;\n}\n",
      AMBIENT,
    ],
    // 그 모듈에서 가져오는 것을 모두 any로 만든다(.d.ts에서 확인 — .ts에서는 moduleDetection: force라 tsc도 막는다)
    [
      '본문 없는 declare module',
      "declare module 'untyped-lib';\nexport {};\n",
      AMBIENT,
    ],
  ])('%s — 막힌다', async (_, code, rule) => {
    expect(await ruleIds(DOMAIN, code)).toContain(rule);
  });

  it.each([
    [PREDICATE, TRUE_GUARD],
    [DEFINITE, 'export let n!: number;\n'],
    [DECLARE_FIELD, 'export class Box {\n  declare n: number;\n}\n'],
    [
      OVERLOAD,
      'export function parse(x: string): number;\nexport function parse(x: unknown): unknown {\n  return x;\n}\n',
    ],
    [AMBIENT, 'export declare const config: { a: string };\n'],
  ])('테스트 파일에서도 막힌다 — %s', async (rule, code) => {
    expect(await ruleIds(DOMAIN_TEST, code)).toContain(rule);
  });

  // .d.ts 안의 선언은 declare 없이도 앰비언트다 — `export const c: number;`는 다른 규칙이 보지 못해서 파일째 막는다
  it.each([
    ['타입만 담은 .d.ts', 'export interface Shape {\n  r: number;\n}\n'],
    ['declare 없이 값을 주장하는 .d.ts', 'export const c: number;\n'],
  ])('%s — 막힌다', async (_, code) => {
    expect(
      await ruleIds('packages/domain/src/task/probe.d.ts', code),
    ).toContain(DECLARATION_FILE);
  });

  // no-restricted-syntax는 설정 블록마다 통째로 덮어써진다 — 이 규칙들이 공통 설정의 no-restricted-syntax에 있었다면 자기 목록을 둔
  // 도메인에서 조용히 빠졌다. 이름이 따로라 둘 다 걸린다
  it('도메인의 최상위 부작용 규칙(no-restricted-syntax)과 함께 걸린다', async () => {
    const ids = await ruleIds(DOMAIN, `console.log(1);\n${TRUE_GUARD}`);
    expect(ids).toContain('no-restricted-syntax');
    expect(ids).toContain(PREDICATE);
  });

  it('양성 대조 — 추론된 서술, 목록에서 찾아 좁히기, boolean을 돌려주는 함수는 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        [
          "export const isText = (x: unknown) => typeof x === 'string';",
          "export const texts = ['a', 1].filter(x => typeof x === 'string');",
          "const NAMES = ['a', 'b'] as const;",
          'export const nameOf = (value: string) => NAMES.find(n => n === value);',
          'export const isPositive = (n: number): boolean => n > 0;',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  // 도메인 프로덕션 코드는 클래스를 못 쓴다(ADR 0011) — 필드는 같은 base가 도는 테스트 파일 경로에서 본다
  it('양성 대조 — 초기값, 생성자 대입, | undefined, optional 필드, 나중에 대입하는 let은 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN_TEST,
        [
          'export class Counter {',
          '  count = 0;',
          '  readonly start: number;',
          '  last: number | undefined;',
          '  label?: string;',
          '  constructor(start: number) {',
          '    this.start = start;',
          '  }',
          '}',
          'export function pick(flag: boolean) {',
          '  let chosen: number | undefined;',
          '  if (flag) chosen = 1;',
          '  return chosen;',
          '}',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  // 타입만인 보강은 ADR 0011이 허용한다 — 앰비언트 블록을 통째로 막지 않는지, 본문 없는 abstract 메서드와 타입 수준 오버로드(TS가
  // 대입할 때 확인한다)가 오버로드 규칙에 걸리지 않는지 본다
  it('양성 대조 — 타입만인 declare global·declare module, abstract 메서드, 호출 시그니처 오버로드는 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN_TEST,
        [
          'declare global {',
          '  interface Window {',
          '    probe?: string;',
          '  }',
          '}',
          "declare module 'virtual:probe' {",
          '  interface Options {',
          '    a: string;',
          '  }',
          '  type Id = string;',
          '}',
          'export abstract class Shape {',
          '  abstract area(): number;',
          '}',
          'export interface Parse {',
          '  (x: string): number;',
          '  (x: number): string;',
          '}',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});

describe('도메인 모듈 폴더', () => {
  const TASK = { type: 'task' };

  it('폴더·배럴이 모듈 목록과 맞으면 문제가 없다 — 테스트 도우미 폴더(src/test)는 모듈이 아니다', () => {
    expect(
      moduleFolderProblems(['task', 'test'], ['index.ts'], [TASK]),
    ).toEqual([]);
  });

  it('목록에 없는 폴더, 폴더 없는 모듈, src 바로 아래 소스 파일, 목록에 없는 allow를 알린다', () => {
    expect(
      moduleFolderProblems(
        ['task', 'order'],
        ['index.ts', 'util.ts'],
        [
          { type: 'task', allow: ['tsk'] },
          { type: 'invoice', allow: ['invoice'] },
        ],
      ),
    ).toEqual([
      'src/order/ — 모듈 목록(domainLayers)에 없다',
      '모듈 invoice — src/invoice/ 폴더가 없다',
      'src/util.ts — src 바로 아래에는 배럴(index.ts)만 둔다. 규칙은 모듈 폴더에 둔다',
      '모듈 task의 allow: tsk — 목록에 있는 다른 모듈만 적는다',
      '모듈 invoice의 allow: invoice — 목록에 있는 다른 모듈만 적는다',
    ]);
  });

  // 위는 검사 함수다 — 실제 도메인 설정이 그 검사를 거친 모듈 목록으로 레이어를 만드는지는 여기서 본다:
  // src 아래의 모든 모듈 폴더에 element가 있어야 한다(목록에 없는 폴더가 배럴에 섞이지 않았다)
  it('도메인 설정은 src 아래 모듈 폴더마다 element를 둔다', async () => {
    const config: unknown = await eslint.calculateConfigForFile(
      path.join(ROOT, DOMAIN),
    );
    const settings =
      typeof config === 'object' && config !== null && 'settings' in config
        ? config.settings
        : undefined;
    const elements =
      typeof settings === 'object' &&
      settings !== null &&
      'boundaries/elements' in settings &&
      Array.isArray(settings['boundaries/elements'])
        ? settings['boundaries/elements']
        : [];
    const patterns = elements.flatMap(element =>
      typeof element === 'object' && element !== null && 'pattern' in element
        ? [element.pattern].flat()
        : [],
    );
    const folders = readdirSync(path.join(ROOT, 'packages/domain/src'), {
      withFileTypes: true,
    })
      .filter(entry => entry.isDirectory() && entry.name !== 'test')
      .map(entry => entry.name);
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) {
      expect(patterns).toContain(`packages/domain/src/${folder}`);
    }
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

// init에서 claude 모듈을 빼면 이 패키지가 없으니 건너뛴다
const GUARD = 'packages/ci-fix-guard/src/probe.ts';

describe.skipIf(
  !existsSync(path.join(ROOT, 'packages/ci-fix-guard/package.json')),
)('CI 자동 수정 검사 패키지', () => {
  // verify 잡이 이 패키지를 node_modules 없는 곳에 복사해 쓴다 — 실행할 때 vitest를 가져오면 그 자리에서 깨진다
  it('vitest를 값으로 가져오면 막힌다', async () => {
    expect(
      await ruleIds(
        GUARD,
        "import { startVitest } from 'vitest/node';\nexport const run = startVitest;\n",
      ),
    ).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('양성 대조 — 타입만 가져오면 통과한다', async () => {
    expect(
      await ruleIds(
        GUARD,
        "import type { Reporter } from 'vitest/node';\nexport type R = Reporter;\n",
      ),
    ).toEqual([]);
  });
});
