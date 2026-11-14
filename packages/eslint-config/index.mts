import { readdirSync } from 'node:fs';
import path from 'node:path';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import type { Linter } from 'eslint';

/**
 * 공통 규칙. 각 앱·패키지는 자기 경로의 eslint.config.mts에서 `base`를 펼치고
 * 그 위에 자기 규칙만 얹는다 (상속 구조).
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
    // 규칙은 설정 파일에서만 바뀐다 — 코드 주석(eslint-disable 등)으로 끄는 길을 막아, 예외가 늘 설정 diff로 드러나게.
    // noInlineConfig는 주석을 무시하고 경고만 내므로, "끈 줄 알았는데 안 꺼진" 죽은 주석이 남지 않게 주석 자체를 오류로 만든다
    plugins: { '@eslint-community/eslint-comments': eslintComments },
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
    },
  },
]);

/**
 * 타입 정보를 쓰는 TS 규칙(기다리지 않은 promise, any 흘리기 등). 패키지의 tsconfig를 읽어 판단한다 —
 * 패키지마다 자기 디렉터리를 넘긴다(`import.meta.dirname`)
 */
export const typeChecked = (tsconfigRootDir: string, files: string[]) =>
  defineConfig({
    files,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir },
    },
  });

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

// 워크스페이스 패키지는 pnpm 심링크의 realpath(packages/...)로 해석되므로 기준 경로를 워크스페이스
// 루트로 둔다. 이 파일 위치에서 계산하는 파일 시스템 경로라 import 별칭을 쓸 수 없다.
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');

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
    // 패키지 루트를 명시한다 — 한 프로세스가 여러 패키지 설정을 불러오면(가드 테스트·에디터) typescript-eslint가
    // "tsconfig 루트 후보가 여럿"이라며 파싱을 거부한다
    languageOptions: { parserOptions: { tsconfigRootDir: packageDir } },
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: path.join(packageDir, 'tsconfig.json'),
        },
      },
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
