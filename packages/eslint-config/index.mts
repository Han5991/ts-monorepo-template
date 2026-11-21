import { readdirSync } from 'node:fs';
import path from 'node:path';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import type { Linter, Rule } from 'eslint';

/**
 * 셀렉터 하나를 막는 규칙. 하는 일은 `no-restricted-syntax`와 같고 규칙 이름만 따로다 — `no-restricted-syntax`는 설정 블록마다
 * 통째로 덮어써져서, 공통 규칙이 그 이름을 쓰면 자기 목록을 둔 패키지(도메인의 `noTopLevelEffects`)에서 조용히 빠진다.
 * 이름이 따로면 덮이지 않고, 예외를 열 때도(ADR 0007) 그 규칙 하나만 꺼진다.
 */
function bannedSyntax(selector: string, message: string): Rule.RuleModule {
  return {
    meta: { type: 'problem', schema: [] },
    create: context => ({
      [selector]: (node: Rule.Node) => context.report({ node, message }),
    }),
  };
}

/**
 * 이 패키지가 정의하는 규칙의 접두(`local/<규칙>`). 워크스페이스 스코프를 접두로 쓰지 않는다 — init이 글에 적힌 스코프를 새
 * 프로젝트 이름으로 바꾸는데, 문자열을 이어 붙여 만든 접두는 바뀌지 않아 규칙을 가리키는 글(테스트·예외 블록)과 어긋난다
 */
const LOCAL_PLUGIN = 'local';

/** 앰비언트 블록(`declare global`·`declare module`·`declare namespace`) — 안의 선언은 구현 없이 바깥에 있는 것을 서술한다 */
const AMBIENT_BLOCK = 'TSModuleDeclaration[declare=true]';
/** 실행할 때 값이 되는 선언 */
const VALUE_DECLARATION =
  ':matches(VariableDeclaration, TSDeclareFunction, ClassDeclaration, TSEnumDeclaration)';

/**
 * 컴파일러가 확인하지 않는 타입 주장(ADR 0018·0020) — 단언(`as`·`!`, ADR 0016)을 막은 뒤 같은 일을 하는 다른 문법이다.
 * `base`가 여기 있는 규칙을 전부 켠다.
 */
const typeClaims = {
  rules: {
    // 함수 본문·오버로드·declare·타입 별칭 어디에 적었든 막는다 — 구현에 붙은 것만 막으면 서술을 붙인 오버로드(구현은
    // boolean)와 본문이 빈 `asserts`가 그대로 통과한다
    'no-type-predicate': bannedSyntax(
      'TSTypePredicate',
      '타입 서술(`x is T`·`asserts x`)은 컴파일러가 본문을 확인하지 않는 단언이다 — 반환 타입을 적지 않으면 TS가 본문에서 확인한 서술을 추론한다. 목록의 값인지는 목록에서 찾아 돌려주고(`find`), 바깥 입력은 스키마(zod)로 파싱한다(ADR 0018).',
    ),
    // 변수·필드·accessor 선언의 `!`. no-non-null-assertion은 식의 `!`(`x!`)만 본다
    'no-definite-assignment-assertion': bannedSyntax(
      '[definite=true]',
      '확정 대입 단언(`x!: T`)은 초기화 검사를 확인 없이 끈다 — 선언할 때 값을 주거나 생성자에서 대입하고, 없을 수 있으면 `| undefined`로 적어 쓰는 곳에서 확인한다(ADR 0018).',
    ),
    // `x!: T`와 같은 일을 하는 다른 한 단어. 최상위 `declare` 값 선언과 앰비언트 블록 안의 값은 no-ambient-value가 본다
    'no-declare-field': bannedSyntax(
      'PropertyDefinition[declare=true]',
      '`declare` 필드는 초기화 검사를 끄고, 실행할 때는 필드를 만들지 않는다(값이 undefined다) — 선언할 때 값을 주거나 생성자에서 대입하고, 없을 수 있으면 `| undefined`로 적는다(ADR 0018).',
    ),
    // 본문 없는 함수·메서드 가운데 앰비언트가 아닌 것이 오버로드 시그니처다(TS는 구현이 바로 뒤따르게 한다). 앰비언트 쪽은
    // no-ambient-value가, abstract 메서드는 노드가 달라(TSAbstractMethodDefinition) 걸리지 않는다
    'no-overload-signature': bannedSyntax(
      `TSDeclareFunction:not([declare=true]):not(${AMBIENT_BLOCK} TSDeclareFunction), MethodDefinition[value.type="TSEmptyBodyFunctionExpression"]:not(ClassDeclaration[declare=true] MethodDefinition):not(${AMBIENT_BLOCK} MethodDefinition)`,
      '오버로드 시그니처는 구현과 느슨하게만 맞춰 봐서 확인 없는 타입 주장이 된다(`unknown`을 돌려주는 구현에 `T`를 돌려주는 오버로드가 컴파일된다) — 입력마다 함수를 나누거나, 이름으로 인덱싱한 mapped type에서 찾아 부르거나, 합집합을 돌려주고 호출부가 좁힌다(ADR 0020).',
    ),
    // `declare` 값 선언, 앰비언트 블록 안의 값, 본문 없는 `declare module 'x';`(그 모듈에서 가져오는 것을 모두 any로 만든다 —
    // `.ts`에서는 moduleDetection: force 때문에 tsc가 막지만, `.d.ts`에 예외를 열면 열린다). 블록 안의 interface·type(타입만인
    // 보강)은 걸리지 않는다(ADR 0011이 허용한다)
    'no-ambient-value': bannedSyntax(
      `${VALUE_DECLARATION}[declare=true], ${AMBIENT_BLOCK} ${VALUE_DECLARATION}, ${AMBIENT_BLOCK}:not([body])`,
      "앰비언트 값 선언(`declare const`·`declare function`…, `declare global`·`declare module` 안의 값)은 구현 없이 그 값이 있고 그 타입이라고 주장한다. 본문 없는 `declare module 'x';`는 그 모듈을 통째로 any로 만든다 — 값은 모듈에서 import하고, 바깥에서 오는 값(전역·환경 변수·타입 없는 패키지)은 unknown으로 받아 스키마로 파싱한다. 타입만인 선언(interface·type)은 된다(ADR 0020).",
    ),
  },
};

// 선언 파일 자체를 막는 규칙(ADR 0020). 그 안의 선언은 `declare` 없이도 앰비언트라 위의 셀렉터가 보지 못하고
// (`export const c: number;`), 파일 이름으로만 가릴 수 있어서 `base`가 선언 파일에서만 켠다
const declarationFile = bannedSyntax(
  'Program',
  '선언 파일(`.d.ts`·`.d.mts`·`.d.cts`·`.d.<확장자>.ts`)은 구현 없이 타입을 주장하고, 그 안의 선언은 `declare` 없이도 앰비언트라 다른 규칙이 보지 못한다 — 타입은 `.ts`에 두고, 도구가 만드는 타입 참조(`/// <reference types="…" />`)는 tsconfig의 `types`로 옮긴다(ADR 0020).',
);

/**
 * TS가 선언 파일로 보는 이름 — `.d.ts`, `.d.mts`·`.d.cts`(TS 4.7), 임의 확장자의 선언 `.d.<확장자>.ts`(TS 5.0, `app.d.css.ts`).
 * `.d.ts`만 잡으면 확장자만 바꿔 빠져나간다(TS 6.0.3에서 넷 모두 `export const c: number;`를 받는 것을 확인)
 */
const DECLARATION_FILES = ['**/*.d.{ts,mts,cts}', '**/*.d.*.ts'];

// 워크스페이스 루트. 이 파일 위치에서 계산하는 파일 시스템 경로라 import 별칭을 쓸 수 없다
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * 공통 규칙. 각 앱·패키지는 자기 경로의 eslint.config.mts에서 `base`를 펼치고
 * 그 위에 자기 규칙만 얹는다 (상속 구조). 타입 정보를 쓰는 규칙도 여기 있어 모든 TS 파일에 켜진다 — 패키지마다 켤 것이 없다.
 *
 * ESLint 10은 린트하는 파일의 디렉터리에서 위로 올라가며 가장 가까운 설정 파일을 쓴다.
 * 그래서 패키지 안의 파일은 그 패키지 설정이 적용된다. 이 패키지가 바뀌면 turbo가
 * 의존 패키지의 lint 캐시를 무효화한다(워크스페이스 의존성 → transit 해시).
 */
export const base = defineConfig([
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // 타입 정보를 쓰는 규칙(ADR 0019) — any 흘리기, 기다리지 않은 promise, 객체를 문자열로 찍기 등. 파일마다 가장 가까운 tsconfig
    // 프로젝트의 타입으로 판단하고, 어느 tsconfig에도 없는 TS 파일은 건너뛰지 않고 파싱 오류로 멈춘다.
    // recommended는 바로 위에 있어 타입 정보를 쓰는 규칙만 더한다. 아래 블록보다 앞에 둬서 base가 바꾼 옵션이 이긴다.
    // 선언 파일은 뺀다 — 파일째 막혀(no-declaration-file, ADR 0020) 이 규칙들이 볼 것이 없고, 저장소에 없는 선언 파일 경로로
    // 넣는 가드 테스트 탐침이 project service 없이 파싱되게 한다(다시 넣으면 그 탐침들이 파싱 오류로 실패한다)
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: DECLARATION_FILES,
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: {
        projectService: true,
        // tsconfig를 이 디렉터리까지만 찾는다 — 루트로 둬야 패키지의 eslint.config.mts(패키지 tsconfig 밖)를 루트 tsconfig.json으로
        // 찾는다. 명시해야 한 프로세스가 여러 패키지 설정을 읽을 때(가드 테스트·에디터) "tsconfig 루트 후보가 여럿"이라는 거부도 없다
        tsconfigRootDir: WORKSPACE_ROOT,
      },
    },
  },
  {
    // 규칙은 설정 파일에서만 바뀐다 — 코드 주석(eslint-disable 등)으로 끄는 길을 막아, 예외가 늘 설정 diff로 드러나게.
    // noInlineConfig는 주석을 무시하고 경고만 내므로, "끈 줄 알았는데 안 꺼진" 죽은 주석이 남지 않게 주석 자체를 오류로 만든다
    plugins: {
      '@eslint-community/eslint-comments': eslintComments,
      [LOCAL_PLUGIN]: {
        rules: { ...typeClaims.rules, 'no-declaration-file': declarationFile },
      },
    },
    linterOptions: { noInlineConfig: true, reportUnusedInlineConfigs: 'error' },
    rules: {
      '@eslint-community/eslint-comments/no-use': 'error',
      eqeqeq: ['error', 'smart'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // 타입 전용 import는 TS의 verbatimModuleSyntax가 강제한다 — 여기선 표기만 맞춘다
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      // 상대 경로 import 대신 패키지 이름이나 package.json imports(#/)를 쓴다
      'no-restricted-imports': ['error', relativeImportBan()],
      // 타입 오류를 덮는 문법은 막는다(ADR 0016) — 아래 셋은 컴파일러의 판단을 검증 없이 뒤집는다.
      // 단언(`x as T`·`<T>x`)은 확인하지 않은 값에 타입을 붙인다. `as const`와 `satisfies`는 타입을 좁히거나 맞춰 볼 뿐이라 걸리지 않는다
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      // `!`는 null·undefined일 수 있다는 오류를 확인 없이 지운다 — 진입점에서 좁히거나 없을 때의 동작을 적는다
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `@ts-expect-error`는 설명을 붙여도 그 줄의 오류를 무엇이든 삼킨다(나중에 생긴 다른 오류까지). 나머지 옵션은 규칙 기본값 그대로다
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': true },
      ],
      // 컴파일러가 확인하지 않는 타입 주장(ADR 0018·0020) — typeClaims에 둔 규칙은 빠짐없이 켠다
      ...Object.fromEntries(
        Object.keys(typeClaims.rules).map(
          name => [`${LOCAL_PLUGIN}/${name}`, 'error'] as const,
        ),
      ),
    },
  },
  {
    files: DECLARATION_FILES,
    rules: { [`${LOCAL_PLUGIN}/no-declaration-file`]: 'error' },
  },
]);

/** 테스트·테스트 헬퍼 파일 (Node에서만 돈다) */
export const TEST_FILES = ['**/*.test.{ts,tsx}', '**/src/test/**'];

/**
 * 순수 코드(브라우저·서버 어디서나 도는 코드)에서 Node 전용 모듈을 막는 규칙.
 * `no-restricted-imports`는 블록마다 통째로 덮어써지므로 상대 경로 금지 패턴도 함께 담는다.
 */
export const noNodeBuiltins: Linter.RulesRecord = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        ...relativeImportBan().patterns,
        {
          group: ['node:*'],
          message:
            '이 코드는 Node 밖(브라우저 등)에서도 돈다. Node 전용 모듈은 조립 지점(main)·테스트·스크립트에서만 쓴다.',
        },
      ],
    },
  ],
};

function relativeImportBan() {
  return {
    patterns: [
      {
        regex: '^\\.{1,2}/',
        message:
          '상대 경로 대신 `#/...`(package.json imports)나 패키지 이름으로 가져온다.',
      },
    ],
  };
}

// ── 레이어 경계 (eslint-plugin-boundaries) ─────────────────────────────────
// 클린 아키텍처의 의존 방향을 element로 적는다: element는 폴더 단위,
// 기본 금지, 허용만 나열한다 — 로컬 레이어·워크스페이스 패키지·npm 모듈·Node 코어 모듈 모두.
// 같은 element 안은 자유이고, 프로덕션은 테스트 파일을 import할 수 없으며, 테스트는 무엇이든 import한다.

// 워크스페이스 패키지 하나가 element 하나다 — 새 패키지가 생겨도 누가 열 수 있는지는 layers에 적어야 열린다
const WORKSPACE_PACKAGES = readdirSync(path.join(WORKSPACE_ROOT, 'packages'), {
  withFileTypes: true,
})
  // 숨김 폴더(도구가 만드는 .claude/ 등)는 패키지가 아니다
  .filter(d => d.isDirectory() && !d.name.startsWith('.'))
  .map(d => d.name);

const pkgType = (name: string) => `pkg:${name}`;

export interface Layer {
  /** element 이름 */
  type: string;
  /** 패키지 루트 기준 폴더. **배열 순서가 우선순위** — 구체 폴더를 먼저, 폴백(src)을 마지막에 */
  pattern: string | string[];
  /** import할 수 있는 같은 패키지의 다른 레이어 */
  allow?: string[];
  /** import할 수 있는 워크스페이스 패키지(packages/ 아래 폴더 이름) */
  packages?: string[];
  /** import할 수 있는 npm 모듈(micromatch, 예: 'hono', '@astryxdesign/**') */
  externals?: string[];
  /** Node 코어 모듈(node:*) 허용 — 로컬 스크립트·테스트 헬퍼만 */
  core?: boolean;
  /** 지정하면 다른 레이어는 이 파일(레이어 폴더 기준)로만 들어올 수 있다 — DDD 모듈의 공개 API */
  entry?: string;
}

export function layers(packageDir: string, list: Layer[]) {
  const unknownPackages = list
    .flatMap(l => l.packages ?? [])
    .filter(p => !WORKSPACE_PACKAGES.includes(p));
  if (unknownPackages.length > 0) {
    throw new Error(`없는 워크스페이스 패키지: ${unknownPackages.join(', ')}`);
  }

  const rel = path.relative(WORKSPACE_ROOT, packageDir);
  const anchor = (p: string) => `${rel}/${p}`;
  const withEntry = list.filter(l => l.entry !== undefined);

  return defineConfig({
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: path.join(packageDir, 'tsconfig.json'),
        },
      },
      // 워크스페이스 패키지는 pnpm 심링크의 realpath(packages/...)로 해석되므로 기준 경로를 워크스페이스 루트로 둔다
      'boundaries/root-path': WORKSPACE_ROOT,
      'boundaries/elements-single-match': true,
      'boundaries/elements': [
        ...list.map(l => ({
          type: l.type,
          pattern: [l.pattern].flat().map(anchor),
        })),
        ...WORKSPACE_PACKAGES.map(name => ({
          type: pkgType(name),
          pattern: `packages/${name}`,
        })),
      ],
      'boundaries/files': [
        { category: 'test', pattern: ['**/*.test.*', '**/*.spec.*'] },
      ],
      // 배럴의 `export * from`도 의존성으로 센다 — 안 세면 배럴 한 줄로 경계를 우회한다
      'boundaries/dependency-nodes': ['import', 'dynamic-import', 'export'],
    },
    rules: {
      // 어떤 element에도 없는 로컬 파일을 import하면 정책 검사를 건너뛰므로 막는다
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // 외부 npm 모듈·Node 코어 모듈도 검사한다 — 프레임워크가 안쪽 레이어로 새지 않게
          checkAllOrigins: true,
          // 같은 element 안도 검사해야 "프로덕션이 옆자리 *.test.ts를 import"를 잡는다
          checkInternals: true,
          // 평가 규칙: 마지막으로 매치된 policy가 이긴다
          policies: [
            ...list.map(l => ({
              from: { element: { type: l.type } },
              allow: [
                {
                  to: {
                    element: {
                      types: {
                        anyOf: [
                          ...(l.allow ?? []),
                          ...(l.packages ?? []).map(pkgType),
                        ],
                      },
                    },
                  },
                },
                ...(l.externals?.length
                  ? [
                      {
                        to: {
                          module: { origin: 'external', source: l.externals },
                        },
                      },
                    ]
                  : []),
                ...(l.core ? [{ to: { module: { origin: 'core' } } }] : []),
              ],
            })),
            // DDD 모듈의 공개 API: 다른 레이어는 entry 파일로만 들어온다(같은 레이어 안은 아래 internal이 다시 연다)
            ...withEntry.map(l => ({
              disallow: {
                to: {
                  element: { type: l.type, fileInternalPath: `!${l.entry}` },
                },
              },
            })),
            {
              dependency: { relationship: { from: 'internal' } },
              allow: { to: { module: { origin: 'local' } } },
            },
            { disallow: { to: { file: { categories: 'test' } } } },
            {
              from: { file: { categories: 'test' } },
              allow: { to: { module: { origin: '*' } } },
            },
          ],
        },
      ],
    },
  });
}

// ── 도메인 패키지 ─────────────────────────────────────────────────────────────

/** 도메인 모듈 하나 — 폴더 `src/<type>`, 공개 API는 그 폴더의 `index.ts` */
export interface DomainModule {
  /** 모듈 이름 = `src` 아래 폴더 이름(명사) */
  type: string;
  /** 이 모듈이 (index.ts로) 쓸 수 있는 다른 도메인 모듈 — 목록에 있는 모듈 이름만 */
  allow?: string[];
  /** import할 수 있는 npm 모듈 */
  externals?: string[];
}

/** 도메인 `src` 바로 아래에 있어도 되는 폴더 — 테스트 도우미(`TEST_FILES`의 `src/test`). 모듈이 아니다 */
const DOMAIN_NON_MODULE_FOLDERS = ['test'];

/**
 * `src` 바로 아래의 폴더·파일과 모듈 목록이 어긋난 곳. 폴더는 모듈 목록과 같아야 하고(테스트 도우미 `test/`는 빼고), 소스 파일은
 * 배럴(`index.ts`) 하나다 — 목록에 없는 폴더는 배럴 element에 섞여 문(`index.ts`) 규칙 없이 열리고, 바로 아래 소스 파일은 모듈
 * 경계를 거치지 않는다. 모듈의 `allow`는 목록에 있는 다른 모듈만 가리킨다(오타는 아무것도 안 연 채 조용히 지나간다).
 */
export function moduleFolderProblems(
  folders: readonly string[],
  files: readonly string[],
  modules: readonly DomainModule[],
): string[] {
  const names = modules.map(module => module.type);
  const problems: string[] = [];
  for (const folder of folders) {
    if (
      !names.includes(folder) &&
      !DOMAIN_NON_MODULE_FOLDERS.includes(folder)
    ) {
      problems.push(`src/${folder}/ — 모듈 목록(domainLayers)에 없다`);
    }
  }
  for (const name of names) {
    if (!folders.includes(name)) {
      problems.push(`모듈 ${name} — src/${name}/ 폴더가 없다`);
    }
  }
  for (const file of files) {
    if (file !== 'index.ts') {
      problems.push(
        `src/${file} — src 바로 아래에는 배럴(index.ts)만 둔다. 규칙은 모듈 폴더에 둔다`,
      );
    }
  }
  for (const module of modules) {
    for (const target of module.allow ?? []) {
      if (target === module.type || !names.includes(target)) {
        problems.push(
          `모듈 ${module.type}의 allow: ${target} — 목록에 있는 다른 모듈만 적는다`,
        );
      }
    }
  }
  return problems;
}

/** `src` 바로 아래의 폴더(숨김 폴더 제외)와 소스 파일(테스트·선언 파일 제외) */
function domainSrcEntries(packageDir: string): {
  folders: string[];
  files: string[];
} {
  const entries = readdirSync(path.join(packageDir, 'src'), {
    withFileTypes: true,
  }).filter(entry => !entry.name.startsWith('.'));
  return {
    folders: entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name),
    files: entries
      .filter(
        entry =>
          entry.isFile() &&
          /\.tsx?$/.test(entry.name) &&
          !/\.(test|d)\.tsx?$/.test(entry.name),
      )
      .map(entry => entry.name),
  };
}

/**
 * 도메인 패키지의 레이어 설정 — 모듈마다 element 하나(공개 API = index.ts)와 배럴(src/index.ts). 설정을 읽을 때 `src`의
 * 폴더·파일과 `allow`가 모듈 목록과 맞는지 보고, 어긋나면 lint가 시작하지 않는다(`moduleFolderProblems`).
 */
export function domainLayers(
  packageDir: string,
  modules: readonly DomainModule[],
) {
  const { folders, files } = domainSrcEntries(packageDir);
  const problems = moduleFolderProblems(folders, files, modules);
  if (problems.length > 0) {
    throw new Error(
      `도메인 모듈 폴더가 목록과 다르다:\n${problems.join('\n')}`,
    );
  }
  return layers(packageDir, [
    ...modules.map((module): Layer => ({
      ...module,
      pattern: `src/${module.type}`,
      entry: 'index.ts',
    })),
    {
      type: 'barrel',
      pattern: 'src',
      allow: modules.map(module => module.type),
    },
  ]);
}

/**
 * 도메인은 불러오기만 해서 일어나는 일이 없다(ADR 0011) — 패키지가 `"sideEffects": false`로 번들러에 그렇게 알린다.
 * 그 전제를 지키는 규칙(허용 목록):
 * - 모듈 최상위 문장은 import·export와 변수·함수·타입 선언, 타입만인 `declare global`·`declare module`뿐이다.
 * - 클래스는 쓰지 않는다(선언·식 모두) — static 블록이 불러올 때 돈다. enum도 불러올 때 객체를 만든다.
 * - 상수의 초기값을 즉시 실행 함수로 만들지 않는다.
 * 초기값 안에서 부르는 함수가 값을 만들기만 하는지(전역을 바꾸거나 등록하지 않는지)는 이 규칙이 못 본다.
 */
export const noTopLevelEffects: Linter.RulesRecord = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        'Program > :not(ImportDeclaration, ExportNamedDeclaration, ExportDefaultDeclaration, ExportAllDeclaration, VariableDeclaration, FunctionDeclaration, TSDeclareFunction, TSTypeAliasDeclaration, TSInterfaceDeclaration, TSModuleDeclaration[declare=true])',
      message:
        '도메인 모듈의 최상위에는 선언만 둔다 — 패키지가 부작용 없는 코드로 알려진다(sideEffects: false). 실행할 일은 함수 안에 둔다.',
    },
    {
      selector:
        'Program > ExportNamedDeclaration > :not(VariableDeclaration, FunctionDeclaration, TSDeclareFunction, TSTypeAliasDeclaration, TSInterfaceDeclaration, ExportSpecifier, Literal)',
      message:
        '도메인이 내보내는 것은 변수·함수·타입 선언만이다 — enum은 불러올 때 객체를 만든다(sideEffects: false).',
    },
    {
      selector:
        'Program > ExportDefaultDeclaration > :not(FunctionDeclaration, Identifier)',
      message:
        '도메인이 기본으로 내보내는 것은 함수 선언이나 이미 선언한 이름뿐이다(sideEffects: false).',
    },
    {
      selector: 'ClassDeclaration, ClassExpression',
      message:
        '도메인은 클래스를 쓰지 않는다 — static 블록이 불러올 때 돈다(sideEffects: false). 규칙은 함수와 값으로 둔다(ADR 0001).',
    },
    {
      selector:
        ':matches(Program, Program > ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator > CallExpression.init > :matches(ArrowFunctionExpression.callee, FunctionExpression.callee)',
      message:
        '상수의 초기값을 즉시 실행 함수로 만들지 않는다 — 불러올 때 돈다(sideEffects: false). 값을 만드는 함수를 따로 두고 부른다.',
    },
  ],
};
