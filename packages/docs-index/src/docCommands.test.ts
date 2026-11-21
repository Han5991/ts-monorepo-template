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
    expect(commandProblems(sources, readWorkspaces(REPO_ROOT))).toEqual([]);
  });
});

const WORKSPACES: Workspaces = {
  root: { name: undefined, scripts: ['lint', 'docs:index'], bins: ['turbo'] },
  packages: [
    { name: '@x/docs', scripts: ['generate', 'lint', 'test'], bins: [] },
    { name: '@x/api', scripts: ['lint', 'dev'], bins: ['vitest'] },
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
    // 띄어 쓴 옵션 값은 작업이 아니다
    'pnpm turbo run lint --filter @x/api',
    'pnpm turbo run lint test --concurrency 1',
    // turbo는 run 없이도 작업을 받는다 — 작업 이름은 run을 붙인 것과 똑같이 본다
    'pnpm turbo lint test --filter @x/api',
    // 옵션만 주면 turbo 자체를 부른 것이다
    'pnpm turbo --version',
    // 고른 패키지에서도 루트의 도구가 돈다 — pnpm이 루트의 .bin도 PATH에 붙인다
    'pnpm --filter @x/docs turbo run lint',
  ])('%s — 돈다', command => {
    expect(commandProblem(command, WORKSPACES)).toBeUndefined();
  });

  it.each([
    ['pnpm index', '루트 package.json에 없는 스크립트다: index'],
    // `run`은 스크립트만 돌린다 — pnpm 자체 명령·도구 이름으로는 통과하지 않는다
    ['pnpm run install', '루트 package.json에 없는 스크립트다: install'],
    ['pnpm run turbo', '루트 package.json에 없는 스크립트다: turbo'],
    // 루트의 스크립트는 고른 패키지에서 돌지 않는다
    [
      'pnpm --filter @x/docs docs:index',
      '@x/docs의 package.json에 없는 스크립트다: docs:index',
    ],
    // 다른 패키지에만 깐 도구도 돌지 않는다 — PATH에 붙는 것은 고른 패키지와 루트의 .bin뿐이다
    [
      'pnpm --filter @x/docs vitest run',
      '@x/docs의 package.json에 없는 스크립트다: vitest',
    ],
    ['pnpm --filter @x/none test', '워크스페이스에 없는 패키지다: @x/none'],
    [
      'pnpm turbo run lint check-types build',
      '어느 패키지에도 없는 작업이다: check-types, build',
    ],
    // 옵션 앞의 작업은 그대로 본다 — 옵션 값(@x/api)은 작업으로 알리지 않는다
    [
      'pnpm turbo run lint check-types --filter @x/api',
      '어느 패키지에도 없는 작업이다: check-types',
    ],
    // 옵션 뒤의 낱말은 값인지 작업인지 가리지 못한다 — 옵션 앞에 작업이 없으면 보지 못한 채 통과시키지 않는다
    [
      'pnpm turbo run --filter=@x/api lint',
      'turbo run 바로 뒤에 작업 이름이 없다(작업은 옵션 앞에 적는다)',
    ],
    [
      'pnpm turbo run',
      'turbo run 바로 뒤에 작업 이름이 없다(작업은 옵션 앞에 적는다)',
    ],
    // run 없이 적은 작업도 본다 — 오타는 turbo도 "Could not find task"로 실패한다
    ['pnpm turbo lnit', '어느 패키지에도 없는 작업이다: lnit'],
    [
      'pnpm turbo --filter=@x/api lint',
      'turbo 바로 뒤에 작업 이름이 없다(작업은 옵션 앞에 적는다)',
    ],
    // 루트의 스크립트는 turbo 작업이 아니다
    ['pnpm turbo run docs:index', '어느 패키지에도 없는 작업이다: docs:index'],
    ['pnpm -r test', '이 검사가 모르는 옵션이다: -r'],
    ['pnpm --filter @x/docs', '실행할 것이 없다'],
  ])('%s — %s', (command, problem) => {
    expect(commandProblem(command, WORKSPACES)).toBe(problem);
  });
});

describe('commandProblem — name 필드가 없는 package.json이 있는 워크스페이스', () => {
  const WITH_NAMELESS: Workspaces = {
    ...WORKSPACES,
    packages: [
      ...WORKSPACES.packages,
      { name: undefined, scripts: ['test'], bins: [] },
    ],
  };

  it('이름을 적은 --filter는 그 이름의 패키지에서만 본다', () => {
    expect(
      commandProblem('pnpm --filter @x/docs test', WITH_NAMELESS),
    ).toBeUndefined();
    expect(commandProblem('pnpm --filter @x/api test', WITH_NAMELESS)).toBe(
      '@x/api의 package.json에 없는 스크립트다: test',
    );
  });

  it.each(['pnpm --filter', 'pnpm --filter=', 'pnpm --filter= test'])(
    '%s — 이름이 없으면 name 없는 package.json과 맞추지 않고 거부한다',
    command => {
      expect(commandProblem(command, WITH_NAMELESS)).toBe('패키지 이름이 없다');
    },
  );
});

describe('commandProblem — 루트도 --filter로 고른다', () => {
  const NAMED_ROOT: Workspaces = {
    ...WORKSPACES,
    root: { ...WORKSPACES.root, name: 'x-root' },
  };

  it('루트의 name으로 고르면 루트의 스크립트를 본다', () => {
    expect(
      commandProblem('pnpm --filter x-root docs:index', NAMED_ROOT),
    ).toBeUndefined();
  });

  it('루트를 골라도 패키지에만 있는 스크립트는 돌지 않는다', () => {
    expect(commandProblem('pnpm --filter x-root generate', NAMED_ROOT)).toBe(
      'x-root의 package.json에 없는 스크립트다: generate',
    );
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
