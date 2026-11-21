import {
  commandProblem,
  commandProblems,
  pnpmCommandsIn,
  proseOf,
  type Workspaces,
} from '#/docCommands.ts';
import { docSources, readWorkspaces, REPO_ROOT, trackedFiles } from '#/repo.ts';
import { describe, expect, it } from 'vitest';

// 이 파일은 예시 명령을 글로 담고 있어 저장소 검사에서 뺀다
const SELF = 'packages/docs-index/src/docCommands.test.ts';

describe('저장소의 문서·주석에 적은 명령', () => {
  it('백틱으로 적은 pnpm 명령이 돈다 — 스크립트 이름을 바꾸거나 지웠으면 안내하는 글도 고친다', () => {
    const files = trackedFiles(REPO_ROOT, '.');
    const sources = docSources(REPO_ROOT, files, [SELF]);
    expect(sources.length).toBeGreaterThan(0);
    expect(commandProblems(sources, readWorkspaces(REPO_ROOT, files))).toEqual(
      [],
    );
  });
});

const WORKSPACES: Workspaces = {
  root: { name: undefined, scripts: ['lint', 'docs:index'], tools: ['turbo'] },
  packages: [
    { name: '@x/docs', scripts: ['generate', 'lint', 'test'], tools: [] },
    { name: '@x/api', scripts: ['lint', 'dev'], tools: ['vitest'] },
  ],
};

describe('commandProblem', () => {
  it.each([
    'pnpm docs:index',
    'pnpm docs:index <이름> --flag',
    'pnpm run lint',
    'pnpm install --frozen-lockfile',
    'pnpm turbo',
    'pnpm --filter @x/docs generate',
    'pnpm --filter=@x/api dev',
    'pnpm --filter @x/api vitest run',
    'pnpm turbo run lint test --filter=@x/api',
  ])('%s — 돈다', command => {
    expect(commandProblem(command, WORKSPACES)).toBeUndefined();
  });

  it.each([
    ['pnpm index', '루트 package.json에 없는 스크립트다: index'],
    // `run`은 스크립트만 돌린다 — pnpm 자체 명령·도구 이름으로는 통과하지 않는다
    ['pnpm run install', '루트 package.json에 없는 스크립트다: install'],
    ['pnpm run turbo', '루트 package.json에 없는 스크립트다: turbo'],
    // 루트에 있는 스크립트·도구라도 고른 패키지에 없으면 돌지 않는다
    [
      'pnpm --filter @x/docs docs:index',
      '@x/docs의 package.json에 없는 스크립트다: docs:index',
    ],
    [
      'pnpm --filter @x/docs turbo run lint',
      '@x/docs의 package.json에 없는 스크립트다: turbo',
    ],
    ['pnpm --filter @x/none test', '워크스페이스에 없는 패키지다: @x/none'],
    [
      'pnpm turbo run lint check-types build',
      '어느 패키지에도 없는 작업이다: check-types, build',
    ],
    ['pnpm -r test', '이 검사가 모르는 옵션이다: -r'],
    ['pnpm --filter @x/docs', '실행할 것이 없다'],
  ])('%s — %s', (command, problem) => {
    expect(commandProblem(command, WORKSPACES)).toBe(problem);
  });
});

describe('pnpmCommandsIn', () => {
  it('백틱 안에서 pnpm으로 시작하는 명령만 꺼낸다 — 같은 명령은 한 번', () => {
    expect(
      pnpmCommandsIn(
        '`pnpm lint` · `pnpm  turbo run test` · pnpm format · `pnpm` · `npm test` · `pnpm-lock.yaml` · `pnpm lint`',
      ),
    ).toEqual(['pnpm lint', 'pnpm  turbo run test']);
  });
});

describe('proseOf', () => {
  it('.md는 전부 안내로 본다', () => {
    expect(proseOf({ path: 'a.md', text: '`pnpm a`\n본문' })).toBe(
      '`pnpm a`\n본문',
    );
  });

  it('그 밖의 파일은 주석으로 시작하는 줄만 본다 — 문자열 데이터에 든 명령은 안내가 아니다', () => {
    expect(
      proseOf({
        path: 'a.ts',
        text: "// `pnpm a`\nconst t = '`pnpm b`';\n/**\n * `pnpm c`\n */\n",
      }),
    ).toBe('// `pnpm a`\n/**\n * `pnpm c`\n */');
    expect(
      proseOf({
        path: 'a.yml',
        text: "# `pnpm a`\nrun: echo '`pnpm b`'\n  # `pnpm c`\n",
      }),
    ).toBe('# `pnpm a`\n  # `pnpm c`');
  });
});

describe('commandProblems', () => {
  it('양성 대조 — 돌지 않는 명령을 어느 글의 어느 명령인지 알린다(문자열 데이터는 보지 않는다)', () => {
    expect(
      commandProblems(
        [
          { path: 'README.md', text: '`pnpm lint` 뒤에 `pnpm index`' },
          {
            path: 'src/a.ts',
            text: "// `pnpm gone`\nconst t = '`pnpm also-gone`';\n",
          },
        ],
        WORKSPACES,
      ),
    ).toEqual([
      'README.md: `pnpm index` — 루트 package.json에 없는 스크립트다: index',
      'src/a.ts: `pnpm gone` — 루트 package.json에 없는 스크립트다: gone',
    ]);
  });
});
