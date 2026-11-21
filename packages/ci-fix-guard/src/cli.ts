import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { changedFiles, compareLedgers } from '#/compare.ts';
import { parseLedger, type Ledger } from '#/ledger.ts';

// 사용: node src/cli.ts <패치 전 기록 디렉터리> <패치 뒤 기록 디렉터리> <패치 파일>
// 저장소 루트에서 실행한다 — 패치의 경로와 기록의 경로를 그 기준으로 맞춘다. 통과하면 0. 거부하면 표준 출력 첫 줄에
// "거부: <한 줄 요약>"을, 표준 오류에 이유를 모두 찍고 1. 기록을 읽지 못해도 거부다(비교하지 못한 채 통과시키지 않는다).

const USAGE =
  '사용: node src/cli.ts <패치 전 기록 디렉터리> <패치 뒤 기록 디렉터리> <패치 파일>';

/** 디렉터리의 기록 파일들. 디렉터리가 없으면 기록이 없는 것이다(비교가 그 이유로 거부한다) */
function readLedgers(dir: string): Ledger[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      const file = path.join(dir, name);
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return parseLedger(raw, file);
    });
}

const [beforeDir, afterDir, patchFile] = process.argv.slice(2);
if (
  beforeDir === undefined ||
  afterDir === undefined ||
  patchFile === undefined
) {
  console.error(USAGE);
  process.exit(2);
}

let problems: string[];
try {
  problems = compareLedgers({
    before: readLedgers(beforeDir),
    after: readLedgers(afterDir),
    changedFiles: changedFiles(readFileSync(patchFile, 'utf8')),
    repoRoot: process.cwd(),
  });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  problems = [`테스트 기록을 비교하지 못했다 — ${reason}`];
}

const [first, ...rest] = problems;
if (first !== undefined) {
  console.log(
    `거부: ${first}${rest.length > 0 ? ` 외 ${String(rest.length)}건` : ''}`,
  );
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(
  '통과: 패치 전에 돌던 테스트가 모두 돌고, 실패한 테스트가 든 파일은 고치지 않았다',
);
