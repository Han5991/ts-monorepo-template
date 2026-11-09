import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

// pnpm init:project <이름> [--without=api,db,claude,renovate]
//
// 템플릿으로 만든 저장소를 한 번 초기화한다.
// 1. 고르지 않은 모듈의 파일·의존성·문서 문단을 지운다(--without, 없으면 터미널에서 묻는다).
// 2. 자리표시자 — 패키지 스코프 `@app/`과 저장소 이름 — 를 이 프로젝트 이름으로 바꾼다.
// 3. 템플릿 전용 파일(이 스크립트, 템플릿 CI)을 지우고 설치·ADR 색인·포맷을 다시 돌린다.
//
// 지우는 것은 `git rm`으로 한다 — ADR 색인(docs-index)이 git이 추적하는 파일만 보기 때문이다.

const ROOT = path.resolve(import.meta.dirname, '..');
const PLACEHOLDER_SCOPE = '@app/';
const PLACEHOLDER_NAME = 'ts-monorepo-template';
const TEXT_FILE = /\.(json|ya?ml|ts|tsx|mts|md)$/;
// 외부에서 가져온 스킬은 출처 판 그대로 둔다
const UNTOUCHED = ['.claude/skills/'];
// 템플릿을 쓰는 동안에만 필요한 것
const TEMPLATE_ONLY = [
  'scripts/init.ts',
  '.github/workflows/template-init.yml',
];

interface Module {
  /** 물을 때 보여 줄 설명 */
  label: string;
  /** 빼면 지우는 경로(파일·폴더) */
  paths: readonly string[];
  /** 빼면 package.json에서 지우는 의존성 — { package.json 경로: [이름] } */
  dependencies?: Readonly<Record<string, readonly string[]>>;
  /** 빼면 pnpm-workspace.yaml catalog에서 지우는 이름 */
  catalog?: readonly string[];
  /** 이 모듈을 빼면 함께 빠지는 모듈 */
  takes?: readonly ModuleName[];
}

const MODULE_NAMES = ['api', 'db', 'claude', 'renovate'] as const;
type ModuleName = (typeof MODULE_NAMES)[number];

const MODULES = {
  api: {
    label:
      'HTTP API(apps/api)와 계약·클라이언트(contracts·api-client·http-client)',
    paths: [
      'apps/api',
      'packages/contracts',
      'packages/api-client',
      'packages/http-client',
      'docs/adr/0002-contract-first-api.md',
      'docs/adr/0003-hono-runtime-neutral.md',
    ],
    catalog: ['hono'],
    takes: ['db'],
  },
  db: {
    label: 'DB 접근면(SqlClient·마이그레이션·SQL 저장소, PGlite 테스트)',
    paths: [
      'apps/api/src/infrastructure/persistence',
      'apps/api/src/test',
      'docs/adr/0004-portable-sql.md',
    ],
    dependencies: { 'apps/api/package.json': ['@electric-sql/pglite'] },
  },
  claude: {
    label: 'Claude 워크플로(PR 코드 리뷰·@claude 멘션)와 .claude/',
    paths: [
      '.github/workflows/claude.yml',
      '.github/workflows/claude-code-review.yml',
      '.github/scripts/claude-result-error.py',
      '.claude',
    ],
  },
  renovate: {
    label: 'Renovate 자동 의존성 업데이트',
    paths: ['renovate.json', 'docs/adr/0008-automated-dependency-updates.md'],
  },
} as const satisfies Record<ModuleName, Module>;

const isModuleName = (value: string): value is ModuleName =>
  MODULE_NAMES.some(m => m === value);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: readonly string[]) {
  const [name, ...rest] = argv;
  if (name === undefined || !/^[a-z][a-z0-9-]*$/.test(name)) {
    fail(
      '사용: pnpm init:project <이름> [--without=api,db,claude,renovate] — 이름은 소문자로 시작하고 소문자·숫자·-만',
    );
  }
  let without: Set<ModuleName> | undefined;
  for (const arg of rest) {
    const m = /^--without=(.*)$/.exec(arg);
    if (!m) fail(`모르는 인자: ${arg}`);
    without = new Set();
    for (const item of (m[1] ?? '').split(',').filter(s => s !== '')) {
      if (!isModuleName(item)) {
        fail(`모르는 모듈: ${item} (${MODULE_NAMES.join('·')} 중에서)`);
      }
      without.add(item);
    }
  }
  return { name, without };
}

async function ask(): Promise<Set<ModuleName>> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const without = new Set<ModuleName>();
  try {
    for (const name of MODULE_NAMES) {
      if (without.has(name)) continue;
      const answer = await rl.question(
        `${name} — ${MODULES[name].label}: 넣을까요? [Y/n] `,
      );
      if (/^n/i.test(answer.trim())) without.add(name);
      if (without.has(name)) {
        for (const taken of takesOf(name)) without.add(taken);
      }
    }
  } finally {
    rl.close();
  }
  return without;
}

function takesOf(name: ModuleName): readonly ModuleName[] {
  const module: Module = MODULES[name];
  return module.takes ?? [];
}

/** 함께 빠지는 모듈까지 넓힌다 */
function closure(without: ReadonlySet<ModuleName>): Set<ModuleName> {
  const all = new Set(without);
  for (const name of without) for (const t of takesOf(name)) all.add(t);
  return all;
}

const run = (command: string, args: readonly string[]) =>
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });

function gitRemove(paths: readonly string[]) {
  const present = paths.filter(p => existsSync(path.join(ROOT, p)));
  if (present.length > 0) run('git', ['rm', '-r', '-q', '--', ...present]);
}

function editJson(file: string, edit: (json: Record<string, unknown>) => void) {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) return;
  const parsed: unknown = JSON.parse(readFileSync(full, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`${file}: JSON 객체가 아니다`);
  }
  const json = { ...parsed };
  edit(json);
  writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`);
}

function dropKeys(value: unknown, keys: readonly string[]): unknown {
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => !keys.includes(k)),
  );
}

function removeDependencies(file: string, names: readonly string[]) {
  editJson(file, json => {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      if (field in json) json[field] = dropKeys(json[field], names);
    }
  });
}

function removeCatalogEntries(names: readonly string[]) {
  const file = path.join(ROOT, 'pnpm-workspace.yaml');
  const lines = readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter(
    line =>
      !names.some(
        n => line.startsWith(`  ${n}:`) || line.startsWith(`  '${n}':`),
      ),
  );
  writeFileSync(file, kept.join('\n'));
}

/**
 * `<!-- module:x:start -->` … `<!-- module:x:end -->` 문단: 뺀 모듈은 통째로, 넣은 모듈은 표시만 지운다.
 * `module:template`은 템플릿 사용법이라 늘 지운다
 */
function applyModuleBlocks(text: string, without: ReadonlySet<ModuleName>) {
  const removed = text.replace(
    /^[ \t]*<!-- module:([a-z]+):start -->\n[\s\S]*?^[ \t]*<!-- module:\1:end -->\n/gm,
    (block, name: string) =>
      name === 'template' || (isModuleName(name) && without.has(name))
        ? ''
        : block,
  );
  return removed.replace(/^[ \t]*<!-- module:[a-z]+:(start|end) -->\n/gm, '');
}

function trackedTextFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(
      f =>
        TEXT_FILE.test(f) &&
        !UNTOUCHED.some(prefix => f.startsWith(prefix)) &&
        existsSync(path.join(ROOT, f)) &&
        // CLAUDE.md는 AGENTS.md를 가리키는 링크다 — 원본만 고친다
        !lstatSync(path.join(ROOT, f)).isSymbolicLink(),
    );
}

const args = parseArgs(process.argv.slice(2));
const without = closure(
  args.without ?? (process.stdin.isTTY ? await ask() : new Set()),
);

for (const name of without) {
  const module: Module = MODULES[name];
  gitRemove(module.paths);
  for (const [file, names] of Object.entries(module.dependencies ?? {})) {
    removeDependencies(file, names);
  }
  if (module.catalog) removeCatalogEntries(module.catalog);
}

gitRemove(TEMPLATE_ONLY);
editJson('package.json', json => {
  json['scripts'] = dropKeys(json['scripts'], ['init:project']);
});

let changed = 0;
for (const file of trackedTextFiles()) {
  const full = path.join(ROOT, file);
  const before = readFileSync(full, 'utf8');
  const after = applyModuleBlocks(before, without)
    .replaceAll(PLACEHOLDER_SCOPE, `@${args.name}/`)
    .replaceAll(PLACEHOLDER_NAME, args.name);
  if (after !== before) {
    writeFileSync(full, after);
    changed += 1;
  }
}

console.log(
  `\n이름: @app/ → @${args.name}/, ${PLACEHOLDER_NAME} → ${args.name} (파일 ${String(changed)}개)`,
);
console.log(
  `뺀 모듈: ${without.size === 0 ? '없음' : [...without].join(', ')}\n`,
);

// 지운 패키지가 lockfile에 남아 있으니 갱신을 허락한다(CI에서는 pnpm이 기본으로 frozen이다)
run('pnpm', ['install', '--no-frozen-lockfile']);
run('pnpm', ['docs:index']);
run('pnpm', ['format']);
run('git', ['add', '-A']);

console.log(
  '\n끝. 다음: pnpm turbo run lint check-types test → 커밋 → README.md를 프로젝트 소개로, AGENTS.md의 "목적"을 채운다',
);
