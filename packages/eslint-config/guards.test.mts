import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { moduleFolderProblems } from '@app/eslint-config';
import { ESLint } from 'eslint';
import { describe, expect, it, vi } from 'vitest';

// lint 설정이 실제로 막는지 확인한다. 규칙을 지우거나 풀면(예외를 넓히면) 여기서 실패한다 —
// "설정에 적혀 있다"가 아니라 "위반을 넣으면 오류가 난다"를 증명한다.
const ROOT = path.resolve(import.meta.dirname, '..', '..');

// 이 프로세스는 같은 파일을 내용을 바꿔 가며 여러 번 lint한다 — 한 번만 도는 실행(single run)이 아니다. typescript-eslint는
// CI(CI=true)에서 single run으로 보고, 내용이 디스크와 같은 파일은 디스크로 만든 Program에서 읽는다. 그러면 탐침 뒤 되돌리기(디스크와
// 같은 내용)가 project service에 닿지 않아 탐침 내용이 남고, 뒤 검사가 바뀐 타입을 본다(CI에서 API 양성 대조가 그렇게 실패했다)
process.env.TSESTREE_SINGLE_RUN = 'false';
const eslint = new ESLint({ cwd: ROOT });

// 처음 보는 tsconfig 프로젝트를 읽는 검사는 느리다 — CI에서 하나에 7초까지 걸렸다(turbo가 다른 작업을 함께 돌린다). 기본 5초로는
// 모자라다
vi.setConfig({ testTimeout: 60_000 });

/**
 * 저장소에 있는 파일의 경로로, 그 내용 대신 `code`를 lint한다 — 그 경로에 가장 가까운 eslint.config.mts가 적용된다. 디스크의 파일은
 * 바꾸지 않는다.
 *
 * 있는 파일이어야 한다: 타입 정보를 쓰는 규칙은 tsconfig 프로젝트에 든 파일만 파싱하는데, 프로젝트는 디스크에 있는 파일로 만들어진다
 * (없는 경로는 "project service가 찾지 못했다"는 파싱 오류). 검사한 뒤 그 파일의 실제 내용으로 다시 lint해 되돌린다 — 타입 정보를
 * 쥔 project service는 프로세스에 하나이고 연 내용을 그대로 들고 있어서, 안 되돌리면 뒤 검사가 이 파일의 타입을 `code`로 본다.
 * 같은 이유로 탐침은 차례로 돈다고 기댄다(Vitest는 한 파일의 테스트를 차례로 돌린다) — concurrent로 돌리면 되돌리기 전의 탐침 내용을
 * 다른 검사가 볼 수 있다.
 */
async function ruleIds(file: string, code: string): Promise<string[]> {
  const filePath = path.join(ROOT, file);
  if (!existsSync(filePath)) {
    throw new Error(`탐침은 저장소에 있는 파일 경로로 넣는다: ${file}`);
  }
  try {
    return await errorRuleIds(filePath, code);
  } finally {
    await eslint.lintText(readFileSync(filePath, 'utf8'), { filePath });
  }
}

/**
 * 선언 파일 경로로 `code`를 lint한다. 선언 파일은 파일째 막혀(ADR 0020) 저장소에 없으니 `ruleIds`처럼 있는 파일로 넣을 수 없다.
 * 타입 정보 블록이 선언 파일을 빼므로 project service 없이 파싱되고, 되돌릴 것도 없다. 그 블록에 선언 파일이 다시 들면 없는 경로라
 * 파싱 오류가 나서 이것을 쓰는 테스트가 실패한다
 */
async function declarationFileRuleIds(
  file: string,
  code: string,
): Promise<string[]> {
  return errorRuleIds(path.join(ROOT, file), code);
}

/** 오류(severity 2)의 규칙 이름 — 파싱 오류처럼 규칙이 없는 오류는 `(fatal) 메시지`로 */
async function errorRuleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error(`lint 결과가 없다: ${filePath}`);
  return result.messages
    .filter(m => m.severity === 2)
    .map(m => m.ruleId ?? `(fatal) ${m.message}`);
}

const FILE_KINDS = {
  source: '소스',
  test: '테스트',
  config: '설정 파일(eslint.config.mts)',
} as const;
type FileKind = keyof typeof FILE_KINDS;

/**
 * 루트와 패키지(apps/*·packages/*)마다 lint가 보는 TS 파일을 종류별로 하나씩 — [어디, 종류, 파일]. 패키지 목록은 저장소를 읽어
 * 만들므로 새 패키지도 저절로 든다. 표본은 각 폴더 바로 아래와 src·scripts 아래에서만 고른다 — 다른 폴더(예: e2e)에만 규칙을 끈
 * 예외는 여기서 잡히지 않는다. 테스트 이름은 파일이 아니라 어디·종류로 짓는다 — 고른 파일의 이름이 바뀌어도 같은 테스트로 남는다
 * (CI 자동 수정 검사는 이름이 바뀐 테스트를 사라진 것으로 본다).
 */
function oneFilePerKind(): [string, string, string][] {
  const packages = ['apps', 'packages'].flatMap(group =>
    existsSync(path.join(ROOT, group))
      ? readdirSync(path.join(ROOT, group), { withFileTypes: true })
          .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
          .map(entry => `${group}/${entry.name}`)
      : [],
  );
  const isTs = (name: string) => /\.[cm]?tsx?$/.test(name);
  const kindOf = (file: string): FileKind =>
    path.basename(file) === 'eslint.config.mts'
      ? 'config'
      : /\.test\.[cm]?tsx?$/.test(file)
        ? 'test'
        : 'source';
  return ['.', ...packages.sort()].flatMap(dir => {
    const top = readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .filter(entry => entry.isFile() && isTs(entry.name))
      .map(entry => path.join(dir, entry.name));
    const nested = ['src', 'scripts'].flatMap(sub =>
      existsSync(path.join(ROOT, dir, sub))
        ? readdirSync(path.join(ROOT, dir, sub), {
            recursive: true,
            encoding: 'utf8',
          })
            .filter(isTs)
            .map(file => path.join(dir, sub, file))
        : [],
    );
    const firstOfKind = new Map<FileKind, string>();
    for (const file of [...top, ...nested].sort()) {
      if (!firstOfKind.has(kindOf(file))) firstOfKind.set(kindOf(file), file);
    }
    return [...firstOfKind].map(([kind, file]): [string, string, string] => [
      dir === '.' ? '루트' : dir,
      FILE_KINDS[kind],
      file,
    ]);
  });
}

const DOMAIN = 'packages/domain/src/task/index.ts';

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
        'packages/domain/src/index.ts',
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
      await ruleIds('packages/domain/src/task/task.test.ts', AS_NUMBER),
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
    [
      '생성자 오버로드',
      'export class Box {\n  constructor(x: string);\n  constructor(_x: unknown) {}\n}\n',
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

  // 선언 파일 안의 선언은 declare 없이도 앰비언트다 — `export const c: number;`는 다른 규칙이 보지 못해서 파일째 막는다.
  // TS는 .d.mts·.d.cts와 임의 확장자의 .d.<확장자>.ts도 선언 파일로 본다 — .d.ts만 잡으면 확장자만 바꿔 빠져나간다
  const VALUE_CLAIM = 'export const c: number;\n';
  it.each([
    [
      '타입만 담은 .d.ts',
      'probe.d.ts',
      'export interface Shape {\n  r: number;\n}\n',
    ],
    ['declare 없이 값을 주장하는 .d.ts', 'probe.d.ts', VALUE_CLAIM],
    ['ESM 선언 파일 .d.mts', 'probe.d.mts', VALUE_CLAIM],
    ['CommonJS 선언 파일 .d.cts', 'probe.d.cts', VALUE_CLAIM],
    ['임의 확장자의 선언 파일 .d.css.ts', 'probe.d.css.ts', VALUE_CLAIM],
  ])('%s — 막힌다', async (_, file, code) => {
    expect(
      await declarationFileRuleIds(`packages/domain/src/task/${file}`, code),
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

// 타입 정보를 쓰는 규칙(ADR 0019) — base에 있어 어느 패키지의 어느 TS 파일에서나 같다
describe('타입 정보를 쓰는 규칙', () => {
  const MEMBER_OF_ANY = '@typescript-eslint/no-unsafe-member-access';
  const READ_NAME =
    'export const name = (text: string): unknown => JSON.parse(text).name;\n';

  it.each([
    // 바깥 입력(JSON.parse·res.json() 등)에서 흘러드는 any
    ['any에서 멤버를 꺼낸다', READ_NAME, MEMBER_OF_ANY],
    [
      'any를 타입 있는 변수에 넣는다',
      'export const read = (text: string) => {\n  const n: number = JSON.parse(text);\n  return n;\n};\n',
      '@typescript-eslint/no-unsafe-assignment',
    ],
    [
      'any를 타입 있는 인자로 넘긴다',
      'const twice = (n: number) => n * 2;\nexport const read = (text: string) => twice(JSON.parse(text));\n',
      '@typescript-eslint/no-unsafe-argument',
    ],
    [
      'any를 타입 있는 반환값으로 돌려준다',
      'export const read = (text: string): number => JSON.parse(text);\n',
      '@typescript-eslint/no-unsafe-return',
    ],
    [
      'any를 함수로 부른다',
      'export const run = (text: string): unknown => JSON.parse(text)();\n',
      '@typescript-eslint/no-unsafe-call',
    ],
    // promise
    [
      '기다리지 않은 promise',
      'const save = (n: number) => Promise.resolve(n);\nexport function run() {\n  save(1);\n}\n',
      '@typescript-eslint/no-floating-promises',
    ],
    [
      '조건식에 둔 promise',
      'export const ready = (done: Promise<boolean>) => (done ? 1 : 0);\n',
      '@typescript-eslint/no-misused-promises',
    ],
    [
      'promise가 아닌 값을 await',
      'export async function wait() {\n  await 1;\n}\n',
      '@typescript-eslint/await-thenable',
    ],
    [
      'await 없는 async',
      'export async function one() {\n  return 1;\n}\n',
      '@typescript-eslint/require-await',
    ],
    // 문자열로 찍으면 '[object Object]'가 되는 값
    [
      'String()에 넘긴 객체',
      'export const label = (value: { id: number }) => String(value);\n',
      '@typescript-eslint/no-base-to-string',
    ],
    [
      '템플릿에 넣은 객체',
      'export const label = (value: { id: number }) => `id: ${value}`;\n',
      '@typescript-eslint/restrict-template-expressions',
    ],
  ])('%s — 막힌다', async (_, code, rule) => {
    expect(await ruleIds(DOMAIN, code)).toContain(rule);
  });

  it('양성 대조 — unknown으로 받아 좁힌 바깥 입력, 기다린 promise, 숫자를 넣은 템플릿은 통과한다', async () => {
    expect(
      await ruleIds(
        DOMAIN,
        [
          'export const name = (text: string): string | undefined => {',
          '  const raw: unknown = JSON.parse(text);',
          "  return typeof raw === 'object' &&",
          '    raw !== null &&',
          "    'name' in raw &&",
          "    typeof raw.name === 'string'",
          '    ? raw.name',
          '    : undefined;',
          '};',
          'export async function saveOne(save: (n: number) => Promise<void>) {',
          '  await save(1);',
          '}',
          'export const label = (id: number) => `id: ${id}`;',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  // 패키지가 규칙을 끄거나(files 블록) 타입 정보 없이 파싱하면 그 패키지의 파일에서 실패한다
  it.each(oneFilePerKind())('%s의 %s에서도 막힌다', async (_, __, file) => {
    expect(await ruleIds(file, READ_NAME), file).toContain(MEMBER_OF_ANY);
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
    // Array.isArray는 unknown을 any[]로 좁힌다 — 원소를 unknown으로 받아 아래에서 좁힌다
    const elements: unknown[] =
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
const USE_CASE = 'apps/api/src/application/use-cases/task-queries.ts';

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
const GUARD = 'packages/ci-fix-guard/src/compare.ts';

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
