import { describe, expect, it } from 'vitest';
import { parseLedger } from '#/ledger.ts';

const TEST = {
  name: '묶음 > 테스트',
  mode: 'run',
  fails: false,
  state: 'passed',
};
const MODULE = {
  file: '/repo/packages/a/src/x.test.ts',
  errors: 0,
  tests: [TEST],
};
const LEDGER = {
  version: 1,
  root: '/repo/packages/a',
  reason: 'failed',
  modules: [MODULE],
};

const withTest = (patch: Record<string, unknown>) => ({
  ...LEDGER,
  modules: [{ ...MODULE, tests: [{ ...TEST, ...patch }] }],
});
const withModule = (patch: Record<string, unknown>) => ({
  ...LEDGER,
  modules: [{ ...MODULE, ...patch }],
});

describe('parseLedger', () => {
  it('보고서가 쓴 모양을 그대로 읽는다', () => {
    expect(parseLedger(structuredClone(LEDGER), 'a.json')).toEqual(LEDGER);
  });

  it.each([
    ['다른 버전', { ...LEDGER, version: 2 }, 'a.json: version'],
    ['모르는 실행 모드', withTest({ mode: 'sometimes' }), 'tests[0].mode'],
    ['모르는 결과', withTest({ state: 'flaky' }), 'tests[0].state'],
    [
      'fails가 true·false가 아니다',
      withTest({ fails: 'yes' }),
      'tests[0].fails',
    ],
    ['이름이 비었다', withTest({ name: '' }), 'tests[0].name'],
    ['파일 오류 수가 음수다', withModule({ errors: -1 }), 'modules[0].errors'],
    ['modules가 배열이 아니다', { ...LEDGER, modules: {} }, 'a.json: modules'],
    ['객체가 아니다', [], 'a.json: 기록'],
  ])('%s — 어디가 다른지 적어 거부한다', (_, raw, where) => {
    expect(() => parseLedger(raw, 'a.json')).toThrow(where);
  });
});
