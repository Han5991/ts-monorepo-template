import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Reporter,
  TestModule,
  TestRunEndReason,
  Vitest,
} from 'vitest/node';
import { LEDGER_VERSION, type Ledger, type LedgerModule } from '#/ledger.ts';

/** 기록을 남길 디렉터리를 받는 환경 변수 — verify 잡이 패치 전과 뒤에 다른 디렉터리를 넘긴다 */
export const LEDGER_DIR_ENV = 'CI_FIX_GUARD_LEDGER';

/**
 * Vitest 보고서. 돌린 테스트를 하나씩 기록으로 남긴다(패키지마다 파일 하나). 다른 보고서와 함께 붙인다:
 * vitest run --reporter=default --reporter=<이 파일>. 기록할 곳을 받지 못하면 실행을 실패시킨다 — 기록 없이 지나가면 비교가
 * 아무것도 보지 않은 채 끝난다.
 */
export default class LedgerReporter implements Reporter {
  private root: string | undefined;

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _unhandledErrors: unknown,
    reason: TestRunEndReason,
  ): void {
    const dir = process.env[LEDGER_DIR_ENV];
    if (dir === undefined || dir === '') {
      throw new Error(
        `${LEDGER_DIR_ENV}가 없다 — 테스트 기록을 남길 디렉터리를 넘긴다`,
      );
    }
    if (this.root === undefined) {
      throw new Error('Vitest가 보고서를 초기화하지 않았다(onInit)');
    }
    const ledger: Ledger = {
      version: LEDGER_VERSION,
      root: this.root,
      reason,
      modules: testModules.map(toModule),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${this.root.replace(/[^\w.-]+/g, '_')}.json`),
      `${JSON.stringify(ledger)}\n`,
    );
  }
}

function toModule(testModule: TestModule): LedgerModule {
  return {
    file: testModule.moduleId,
    errors: testModule.errors().length,
    tests: [...testModule.children.allTests()].map(test => ({
      name: test.fullName,
      mode: test.options.mode,
      fails: test.options.fails === true,
      state: test.result().state,
    })),
  };
}
