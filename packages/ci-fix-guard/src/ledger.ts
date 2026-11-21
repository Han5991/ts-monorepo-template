/**
 * 테스트 기록(ledger) — Vitest가 돌린 테스트를 하나씩 적은 것. 보고서(reporter.ts)가 패키지마다 하나씩 쓰고, 비교(compare.ts)가
 * 패치 전과 뒤의 기록을 읽는다. 값은 Vitest 보고서 API(TestCase·TestModule)에서 비교에 필요한 것만 옮긴다 — 아래 목록이 Vitest의
 * 타입과 어긋나면 보고서의 대입이 타입 오류가 되어, Vitest를 올렸을 때 조용히 틀린 기록을 쓰지 않는다.
 */

export const LEDGER_VERSION = 1;

/** 선언된 실행 모드. only는 돈다(같은 파일의 다른 테스트를 끈다), skip·todo는 돌지 않는다 */
export const TEST_MODES = ['run', 'only', 'skip', 'todo'] as const;
export type TestMode = (typeof TEST_MODES)[number];

/** 결과. 실행 중에 건너뛴(ctx.skip) 테스트는 모드가 run이어도 skipped다 */
export const TEST_STATES = ['passed', 'failed', 'skipped', 'pending'] as const;
export type TestState = (typeof TEST_STATES)[number];

/** 테스트 파일의 결과. 테스트가 실패해도, 훅(beforeAll 등)이 실패해도, 불러오지 못해도 failed다 */
export const MODULE_STATES = [
  'passed',
  'failed',
  'skipped',
  'pending',
  'queued',
] as const;
export type ModuleState = (typeof MODULE_STATES)[number];

/** 실행이 어떻게 끝났나 — interrupted면 기록이 모자란다 */
export const RUN_END_REASONS = ['passed', 'failed', 'interrupted'] as const;
export type RunEndReason = (typeof RUN_END_REASONS)[number];

export interface LedgerTest {
  /** describe부터 이어 붙인 이름(Vitest의 fullName) */
  readonly name: string;
  readonly mode: TestMode;
  /** 실패를 기대하는 테스트(it.fails·{ fails: true }) — 통과로 보고돼도 결과가 뒤집혀 있다 */
  readonly fails: boolean;
  readonly state: TestState;
}

export interface LedgerModule {
  /** 테스트 파일의 절대 경로 */
  readonly file: string;
  /**
   * 파일의 결과. 훅이 실패한 묶음의 테스트는 결과가 skipped로만 남으므로(파일 오류 수도 0이다), 실패한 파일인지는 이것으로 본다
   */
  readonly state: ModuleState;
  /** 파일 단위 오류 수(불러오기 실패 등 — 묶음의 훅 오류는 세지 않는다). 불러오지 못한 파일은 tests가 비어 있다 */
  readonly errors: number;
  readonly tests: readonly LedgerTest[];
}

export interface Ledger {
  readonly version: typeof LEDGER_VERSION;
  /** Vitest root — 패키지 디렉터리의 절대 경로 */
  readonly root: string;
  readonly reason: RunEndReason;
  readonly modules: readonly LedgerModule[];
}

/** JSON으로 읽은 기록을 좁힌다. 모양이 다르면 어디가 다른지 적어 throw한다 — 비교는 믿을 수 있는 기록으로만 한다 */
export function parseLedger(raw: unknown, source: string): Ledger {
  const ledger = fields(raw, `${source}: 기록`);
  if (ledger.get('version') !== LEDGER_VERSION) {
    throw new Error(
      `${source}: version은 ${String(LEDGER_VERSION)}이어야 한다`,
    );
  }
  return {
    version: LEDGER_VERSION,
    root: text(ledger.get('root'), `${source}: root`),
    reason: oneOf(ledger.get('reason'), RUN_END_REASONS, `${source}: reason`),
    modules: list(ledger.get('modules'), `${source}: modules`).map((item, i) =>
      parseModule(item, `${source}: modules[${String(i)}]`),
    ),
  };
}

function parseModule(raw: unknown, where: string): LedgerModule {
  const module = fields(raw, where);
  const errors = module.get('errors');
  if (typeof errors !== 'number' || !Number.isInteger(errors) || errors < 0) {
    throw new Error(`${where}.errors는 0 이상의 정수여야 한다`);
  }
  return {
    file: text(module.get('file'), `${where}.file`),
    state: oneOf(module.get('state'), MODULE_STATES, `${where}.state`),
    errors,
    tests: list(module.get('tests'), `${where}.tests`).map((item, i) =>
      parseTest(item, `${where}.tests[${String(i)}]`),
    ),
  };
}

function parseTest(raw: unknown, where: string): LedgerTest {
  const test = fields(raw, where);
  const fails = test.get('fails');
  if (typeof fails !== 'boolean') {
    throw new Error(`${where}.fails는 true·false여야 한다`);
  }
  return {
    name: text(test.get('name'), `${where}.name`),
    mode: oneOf(test.get('mode'), TEST_MODES, `${where}.mode`),
    fails,
    state: oneOf(test.get('state'), TEST_STATES, `${where}.state`),
  };
}

/** 객체의 필드들 — 값은 확인 전이니 unknown으로 받는다 */
function fields(value: unknown, where: string): ReadonlyMap<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where}는 객체여야 한다`);
  }
  return new Map<string, unknown>(Object.entries(value));
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${where}는 비어 있지 않은 문자열이어야 한다`);
  }
  return value;
}

function list(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}는 배열이어야 한다`);
  return value;
}

function oneOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  where: string,
): T {
  const found = allowed.find(item => item === value);
  if (found === undefined) {
    throw new Error(`${where}는 ${allowed.join('·')} 가운데 하나여야 한다`);
  }
  return found;
}
