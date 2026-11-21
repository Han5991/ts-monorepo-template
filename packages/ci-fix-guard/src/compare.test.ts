import { describe, expect, it } from 'vitest';
import { changedFiles, compareLedgers } from '#/compare.ts';
import type { Ledger, LedgerModule, LedgerTest } from '#/ledger.ts';

const REPO = '/repo';
const ROOT = '/repo/packages/a';
const FILE = '/repo/packages/a/src/sum.test.ts';
const SOURCE = 'packages/a/src/sum.ts';
const TEST_FILE = 'packages/a/src/sum.test.ts';

const test = (name: string, patch: Partial<LedgerTest> = {}): LedgerTest => ({
  name,
  mode: 'run',
  fails: false,
  state: 'passed',
  ...patch,
});
const module = (
  tests: LedgerTest[],
  patch: Partial<LedgerModule> = {},
): LedgerModule => ({ file: FILE, errors: 0, tests, ...patch });
const ledger = (
  modules: LedgerModule[],
  patch: Partial<Ledger> = {},
): Ledger => ({
  version: 1,
  root: ROOT,
  reason: 'passed',
  modules,
  ...patch,
});
const compare = (
  before: Ledger[],
  after: Ledger[],
  files: string[] = [SOURCE],
) => compareLedgers({ before, after, changedFiles: files, repoRoot: REPO });

const BEFORE = [
  ledger(
    [module([test('sum > 더한다', { state: 'failed' }), test('sum > 0')])],
    {
      reason: 'failed',
    },
  ),
];

describe('compareLedgers — 통과', () => {
  it('실패하던 테스트가 코드를 고쳐 통과하면 문제가 없다', () => {
    expect(
      compare(BEFORE, [
        ledger([module([test('sum > 더한다'), test('sum > 0')])]),
      ]),
    ).toEqual([]);
  });

  it('새 테스트를 더해도 되고, 패치 전에 이미 돌지 않던 테스트는 보지 않는다', () => {
    const before = [
      ledger([
        module([
          test('sum > 0'),
          test('sum > 나중에', { mode: 'skip', state: 'skipped' }),
          test('sum > 알려진 실패', { fails: true }),
        ]),
      ]),
    ];
    const after = [
      ledger([
        module([
          test('sum > 0'),
          test('sum > 새로 더함'),
          test('sum > 나중에', { mode: 'todo', state: 'skipped' }),
        ]),
      ]),
    ];
    expect(compare(before, after)).toEqual([]);
  });

  it('only로 도는 테스트는 도는 것으로 본다', () => {
    expect(
      compare(
        [ledger([module([test('sum > 0')])])],
        [ledger([module([test('sum > 0', { mode: 'only' })])])],
      ),
    ).toEqual([]);
  });
});

describe('compareLedgers — 패치 전에 돌던 테스트는 패치 뒤에도 돌아야 한다', () => {
  it.each([
    [
      '건너뛰게 바꾸기',
      { mode: 'skip', state: 'skipped' },
      '건너뛰게 바뀌었다(skip)',
    ],
    [
      '할 일로 바꾸기',
      { mode: 'todo', state: 'skipped' },
      '할 일로 바뀌었다(todo)',
    ],
    [
      '실패를 기대하게 바꾸기',
      { fails: true },
      '실패를 기대하게 바뀌었다(fails)',
    ],
    [
      '실행 중에 건너뛰기',
      { state: 'skipped' },
      '실행 중에 건너뛴다(ctx.skip 등)',
    ],
  ] as const)('%s — 막힌다', (_, patch, reason) => {
    expect(
      compare(BEFORE, [
        ledger([module([test('sum > 더한다', patch), test('sum > 0')])]),
      ]),
    ).toEqual([`${TEST_FILE} > sum > 더한다 — ${reason}`]);
  });

  it('지우거나 이름을 바꾸면 사라진 것으로 본다', () => {
    expect(
      compare(BEFORE, [
        ledger([module([test('sum > 이름을 바꿈'), test('sum > 0')])]),
      ]),
    ).toEqual([
      `${TEST_FILE} > sum > 더한다 — 테스트가 사라졌다(지웠거나 이름을 바꿨다)`,
    ]);
  });

  it('테스트 파일을 불러오지 못하게 되면 그 이유로 알린다', () => {
    expect(
      compare(BEFORE, [ledger([module([], { errors: 1 })])]).map(problem =>
        problem.replace(/ > .* — /, ' > … — '),
      ),
    ).toEqual([
      `${TEST_FILE} > … — 테스트 파일을 불러오지 못했다`,
      `${TEST_FILE} > … — 테스트 파일을 불러오지 못했다`,
    ]);
  });

  it('같은 이름의 테스트는 개수로 센다', () => {
    expect(
      compare(
        [ledger([module([test('sum > 같다'), test('sum > 같다')])])],
        [ledger([module([test('sum > 같다')])])],
      ),
    ).toEqual([
      `${TEST_FILE} > sum > 같다 — 같은 이름의 테스트가 줄었다 (1개)`,
    ]);
  });
});

describe('compareLedgers — 패치 전에 실패한 테스트가 든 파일은 고치지 못한다', () => {
  it('실패한 테스트의 파일을 고친 패치는 막힌다(단언을 실패에 맞춰 바꾸는 길)', () => {
    expect(
      compare(
        BEFORE,
        [ledger([module([test('sum > 더한다'), test('sum > 0')])])],
        [TEST_FILE],
      ),
    ).toEqual([
      `${TEST_FILE} — 패치 전에 실패한 테스트가 든 파일을 고쳤다. 테스트가 아니라 테스트가 검사하는 코드를 고친다`,
    ]);
  });

  it('통과하던 테스트만 든 파일, 불러오기부터 실패한 파일은 고쳐도 된다', () => {
    const other = '/repo/packages/a/src/other.test.ts';
    const broken = '/repo/packages/a/src/broken.test.ts';
    const before = [
      ledger([
        module([test('other > 통과')], { file: other }),
        module([], { file: broken, errors: 1 }),
      ]),
    ];
    const after = [
      ledger([
        module([test('other > 통과')], { file: other }),
        module([test('broken > 이제 돈다')], { file: broken }),
      ]),
    ];
    expect(
      compare(before, after, [
        'packages/a/src/other.test.ts',
        'packages/a/src/broken.test.ts',
      ]),
    ).toEqual([]);
  });
});

describe('compareLedgers — 기록을 믿을 수 없으면 통과시키지 않는다', () => {
  it('패치 전 기록이 없으면 막힌다', () => {
    expect(compare([], [])).toEqual([
      '패치 전 테스트 기록이 없다 — 비교할 것이 없어 통과시키지 않는다',
    ]);
  });

  it('패치 뒤에 패키지의 기록이 없으면 그 패키지를 한 줄로 알린다', () => {
    expect(compare(BEFORE, [])).toEqual([
      'packages/a: 패치 뒤 테스트 기록이 없다(테스트가 돌지 않았다)',
    ]);
  });

  it('패치 전 기록이 빠진 패키지가 있으면 막힌다 — 그 패키지의 테스트를 지켰는지 볼 수 없다', () => {
    const other = ledger(
      [module([test('b > 통과')], { file: '/repo/packages/b/src/b.test.ts' })],
      {
        root: '/repo/packages/b',
      },
    );
    expect(
      compare(BEFORE, [
        ledger([module([test('sum > 더한다'), test('sum > 0')])]),
        other,
      ]),
    ).toEqual([
      'packages/b: 패치 전 테스트 기록이 없다 — 이 패키지의 테스트를 지켰는지 볼 수 없다',
    ]);
  });

  it('실행이 중간에 끊긴 기록은 막힌다', () => {
    const after = [
      ledger([module([test('sum > 더한다'), test('sum > 0')])], {
        reason: 'interrupted',
      }),
    ];
    expect(compare(BEFORE, after)).toEqual([
      'packages/a: 패치 뒤 테스트 실행이 중간에 끊겼다',
    ]);
  });
});

describe('changedFiles', () => {
  it('패치 머리에서 고친 파일을 읽는다', () => {
    expect(
      changedFiles(
        [
          'diff --git a/packages/a/src/sum.ts b/packages/a/src/sum.ts',
          'index 1..2 100644',
          '--- a/packages/a/src/sum.ts',
          '+++ b/packages/a/src/sum.ts',
          '@@ -1 +1 @@',
          '-diff --git a/본문 b/본문',
          'diff --git a/README.md b/README.md',
          '',
        ].join('\n'),
      ),
    ).toEqual(['packages/a/src/sum.ts', 'README.md']);
  });

  it.each([
    [
      '따옴표로 감싼 경로',
      'diff --git "a/\\354\\204\\244.ts" "b/\\354\\204\\244.ts"',
    ],
    ['양쪽 경로가 다르다(이름 바꾸기)', 'diff --git a/x.ts b/y.ts'],
  ])('%s — 읽지 못하면 throw한다', (_, line) => {
    expect(() => changedFiles(`${line}\n`)).toThrow('경로를 읽지 못했다');
  });
});
