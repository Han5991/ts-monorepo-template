import path from 'node:path';
import type { Ledger, LedgerTest } from '#/ledger.ts';

/**
 * 패치 전과 뒤의 테스트 기록을 비교해 거부할 이유를 돌려준다(없으면 빈 배열). 규칙:
 * - 기록을 믿을 수 있어야 한다 — 패치 전 기록이 없거나, 실행이 중간에 끊겼거나, 한쪽에만 기록이 있는 패키지가 있으면 거부한다
 *   (비교하지 못한 채 통과시키지 않는다). 패치 전 기록이 빠진 패키지는 그 테스트를 지켰는지 볼 수 없다.
 * - 패치 전에 실제로 돌던 테스트는 패치 뒤에도 실제로 돌아야 한다. 테스트를 끄는 문법(skip·todo·fails·only·실행 중 건너뛰기,
 *   별칭·상수·다른 파일의 옵션)과 상관없이 결과로 본다. 지우거나 이름을 바꿔도 사라진 것으로 본다. 패치 전에 이미 돌지 않던
 *   테스트는 보지 않는다.
 * - 패치 전에 실패한 테스트가 든 파일은 패치가 고치지 못한다 — 테스트를 실패에 맞추지 말고 테스트가 검사하는 코드를 고친다.
 *   불러오기부터 실패한 파일(테스트가 하나도 없는 파일)은 여기에 들지 않는다(import 경로를 고칠 수 있게).
 * 경로는 repoRoot 기준 상대 경로로 맞춘다(패치의 경로가 저장소 루트 기준이다).
 */
export function compareLedgers({
  before,
  after,
  changedFiles,
  repoRoot,
}: {
  before: readonly Ledger[];
  after: readonly Ledger[];
  changedFiles: readonly string[];
  repoRoot: string;
}): string[] {
  const relative = (file: string) => path.relative(repoRoot, file) || '.';
  if (before.length === 0) {
    return ['패치 전 테스트 기록이 없다 — 비교할 것이 없어 통과시키지 않는다'];
  }

  const problems: string[] = [];
  for (const [phase, ledgers] of [
    ['패치 전', before],
    ['패치 뒤', after],
  ] as const) {
    for (const ledger of ledgers) {
      if (ledger.reason === 'interrupted') {
        problems.push(
          `${relative(ledger.root)}: ${phase} 테스트 실행이 중간에 끊겼다`,
        );
      }
    }
  }
  const afterRoots = new Set(after.map(ledger => ledger.root));
  const missingRoots = new Set(
    before.map(ledger => ledger.root).filter(root => !afterRoots.has(root)),
  );
  for (const root of missingRoots) {
    problems.push(
      `${relative(root)}: 패치 뒤 테스트 기록이 없다(테스트가 돌지 않았다)`,
    );
  }
  const beforeRoots = new Set(before.map(ledger => ledger.root));
  for (const ledger of after) {
    if (!beforeRoots.has(ledger.root)) {
      problems.push(
        `${relative(ledger.root)}: 패치 전 테스트 기록이 없다 — 이 패키지의 테스트를 지켰는지 볼 수 없다`,
      );
    }
  }

  // 기록이 통째로 없는 패키지는 위에서 한 줄로 알렸다 — 그 안의 테스트를 하나씩 다시 적지 않는다
  const activeBefore = new Map<string, { title: string; count: number }>();
  for (const { root, file, test } of tests(before)) {
    if (!isActive(test) || missingRoots.has(root)) continue;
    const id = testId(relative(file), test);
    const seen = activeBefore.get(id);
    activeBefore.set(id, {
      title: `${relative(file)} > ${test.name}`,
      count: (seen?.count ?? 0) + 1,
    });
  }
  const afterById = new Map<string, LedgerTest[]>();
  for (const { file, test } of tests(after)) {
    const id = testId(relative(file), test);
    afterById.set(id, [...(afterById.get(id) ?? []), test]);
  }
  const erroredAfter = new Set(
    after.flatMap(ledger =>
      ledger.modules
        .filter(module => module.errors > 0)
        .map(module => relative(module.file)),
    ),
  );
  for (const [id, { title, count }] of activeBefore) {
    const now = afterById.get(id) ?? [];
    const missing = count - now.filter(isActive).length;
    if (missing <= 0) continue;
    const file = title.slice(0, title.indexOf(' > '));
    const inactive = now.find(test => !isActive(test));
    const reason =
      inactive !== undefined
        ? inactiveReason(inactive)
        : now.length > 0
          ? '같은 이름의 테스트가 줄었다'
          : erroredAfter.has(file)
            ? '테스트 파일을 불러오지 못했다'
            : '테스트가 사라졌다(지웠거나 이름을 바꿨다)';
    problems.push(
      `${title} — ${reason}${count > 1 ? ` (${String(missing)}개)` : ''}`,
    );
  }

  const failedFiles = new Set(
    tests(before)
      .filter(({ test }) => test.state === 'failed')
      .map(({ file }) => relative(file)),
  );
  for (const file of changedFiles) {
    if (failedFiles.has(file)) {
      problems.push(
        `${file} — 패치 전에 실패한 테스트가 든 파일을 고쳤다. 테스트가 아니라 테스트가 검사하는 코드를 고친다`,
      );
    }
  }
  return problems;
}

/** 패치(git diff)가 고친 파일들 — 머리의 경로를 읽지 못하면 throw한다(읽지 못한 파일을 비교에서 빼지 않는다) */
export function changedFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const match = /^diff --git a\/(.+) b\/\1$/.exec(line);
    if (match?.[1] === undefined) {
      throw new Error(`패치 머리에서 경로를 읽지 못했다: ${line}`);
    }
    files.push(match[1]);
  }
  return files;
}

/** 실제로 도는 테스트 — 모드가 run·only이고, 실패를 기대하지 않고, 결과가 건너뜀·보류가 아니다 */
function isActive(test: LedgerTest): boolean {
  return (
    (test.mode === 'run' || test.mode === 'only') &&
    !test.fails &&
    test.state !== 'skipped' &&
    test.state !== 'pending'
  );
}

function inactiveReason(test: LedgerTest): string {
  if (test.mode === 'skip') return '건너뛰게 바뀌었다(skip)';
  if (test.mode === 'todo') return '할 일로 바뀌었다(todo)';
  if (test.fails) return '실패를 기대하게 바뀌었다(fails)';
  if (test.state === 'skipped') return '실행 중에 건너뛴다(ctx.skip 등)';
  return '결과가 없다';
}

function tests(
  ledgers: readonly Ledger[],
): { root: string; file: string; test: LedgerTest }[] {
  return ledgers.flatMap(ledger =>
    ledger.modules.flatMap(module =>
      module.tests.map(test => ({
        root: ledger.root,
        file: module.file,
        test,
      })),
    ),
  );
}

/** 테스트를 가리키는 열쇠 — 파일과 이름(파일 경로와 이름에 들 수 없는 문자로 잇는다) */
function testId(file: string, test: LedgerTest): string {
  return `${file}\u0000${test.name}`;
}
