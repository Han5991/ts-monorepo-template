import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEDGER_DIR_ENV } from '#/reporter.ts';

// verify 잡(워크플로)은 이 패키지를 import할 수 없어 환경 변수 이름과 파일 경로를 글로 적는다 — 그 사본이 어긋나지 않게 잠근다.
// 어긋나면 보고서가 기록할 곳을 받지 못해 실행을 실패시키거나 비교가 기록을 찾지 못해, 모든 자동 수정이 거부된다.
const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const WORKFLOW = path.resolve(
  PACKAGE_DIR,
  '../../.github/workflows/claude-ci-fix.yml',
);

describe('verify 잡이 적은 이름과 경로', () => {
  const text = readFileSync(WORKFLOW, 'utf8');
  /** 이름으로 찾은 스텝 하나 — 이름 줄부터 그 스텝의 줄(들여쓰기 8칸 이상)이 끝날 때까지. 없으면 throw한다 */
  const stepNamed = (name: string): string => {
    const lines = text.split('\n');
    const start = lines.indexOf(`      - name: ${name}`);
    if (start === -1) throw new Error(`워크플로에 "${name}" 스텝이 없다`);
    const end = lines.findIndex(
      (line, i) => i > start && line !== '' && !line.startsWith('        '),
    );
    return lines.slice(start, end === -1 ? undefined : end).join('\n');
  };
  /** 스텝이 보고서에 넘기는 기록 디렉터리(runner.temp 아래) */
  const REPORTER_DIR = new RegExp(
    `${LEDGER_DIR_ENV}: \\$\\{\\{ runner\\.temp \\}\\}/(\\S+)`,
  );
  /**
   * 스텝에서 찾은 RUNNER_TEMP 아래 디렉터리. 실행할 때처럼 RUNNER_TEMP 뒤에 이어 붙여 푼다(끝의 `/`, 사이의 `./`·`//`·`..`) —
   * 글자가 달라도 같은 디렉터리면 같은 값이 된다. 못 찾으면 throw한다
   */
  const runnerTempDir = (step: string, pattern: RegExp): string => {
    const dir = pattern.exec(step)?.[1];
    if (dir === undefined) {
      throw new Error(`스텝에서 ${String(pattern)}에 맞는 디렉터리가 없다`);
    }
    return path.posix.resolve(`/runner-temp/${dir}`);
  };

  it('패치 전과 뒤에 보고서가 읽는 환경 변수로 기록할 곳을 넘긴다', () => {
    expect(text.match(new RegExp(`\\b${LEDGER_DIR_ENV}:`, 'g'))).toHaveLength(
      2,
    );
  });

  // 의존 순서로 돌리면 테스트가 실패한 패키지에 기대는 패키지는 돌지 않아 패치 전 기록이 빠진다(비교가 그 패키지를 거부한다)
  it('패치 전 테스트는 실패해도 모든 패키지를 의존 순서 없이 돌린다', () => {
    expect(text).toContain('pnpm -r --no-bail --no-sort run test');
  });

  // 다른 디렉터리를 보면 경고가 늘 찍히거나 전혀 찍히지 않는다 — 기록이 빠진 원인을 실행 요약에서 찾지 못한다
  it('패치 전 기록이 하나도 남지 않으면 경고를 찍는다 — 보고서에 넘긴 디렉터리를 본다', () => {
    const step = stepNamed('Record tests before the patch');
    expect(step).toContain(`${LEDGER_DIR_ENV}:`);
    expect(step).toContain(`"$${LEDGER_DIR_ENV}"`);
    expect(step).toContain('::warning::');
  });

  // 패치 전 기록 디렉터리는 두 스텝에 따로 적는다(이유는 워크플로의 그 자리에). 어긋나면 비교가 없는 디렉터리를 읽어 모든 패치를
  // 기록이 없다는 이유로 거부하고, 기록 스텝의 경고도 찍히지 않는다
  it('비교는 두 보고서가 기록한 디렉터리를 패치 전·뒤 순서로 읽는다', () => {
    const check = stepNamed('Full checks');
    // 둘째 인자가 그 스텝의 보고서가 읽는 환경 변수일 때만 맞는다 — 패치 뒤 기록은 같은 스텝의 보고서가 쓴 곳에서 읽는다
    const cliBeforeDir = new RegExp(
      `ci-fix-guard/src/cli\\.ts" "\\$RUNNER_TEMP/([^"]+)" "\\$${LEDGER_DIR_ENV}"`,
    );
    expect(runnerTempDir(check, cliBeforeDir)).toBe(
      runnerTempDir(stepNamed('Record tests before the patch'), REPORTER_DIR),
    );
    expect(check).toContain(`${LEDGER_DIR_ENV}:`);
  });

  // 같은 디렉터리면(끝의 `/`처럼 글자만 달라도) 패치 뒤 보고서가 같은 파일 이름으로 패치 전 기록을 덮어쓴다. 비교가 패치 뒤
  // 결과끼리 맞대게 되어, 돌던 테스트를 끈 패치도 실패한 테스트의 파일을 고친 패치도 조용히 통과한다
  it('패치 뒤 기록은 패치 전 기록과 다른 디렉터리에 남긴다', () => {
    expect(runnerTempDir(stepNamed('Full checks'), REPORTER_DIR)).not.toBe(
      runnerTempDir(stepNamed('Record tests before the patch'), REPORTER_DIR),
    );
  });

  it('기본 브랜치에서 이 패키지를 꺼내 온다', () => {
    expect(text).toMatch(/sparse-checkout: \|[^]*?packages\/ci-fix-guard\n/);
  });

  it.each(['src/reporter.ts', 'src/cli.ts'])(
    '복사한 판의 %s를 쓰고, 그 파일이 이 패키지에 있다',
    file => {
      expect(text).toContain(`ci-fix-guard/${file}`);
      expect(existsSync(path.join(PACKAGE_DIR, file))).toBe(true);
    },
  );
});
