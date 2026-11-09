import semver from 'semver';
import { z } from 'zod';

/** renovate.json에서 이 도구가 만든 규칙을 알아보는 표시. 이 접두어로 시작하는 규칙은 손으로 고치지 않는다 */
export const GATE_PREFIX = '[upgrade-gate]';

const BlockerSchema = z.strictObject({
  /** 새 버전을 막는 패키지(그 최신판의 peerDependencies가 기준) */
  package: z.string().min(1),
  /** 그 peer 범위 */
  range: z.string().min(1),
});
export type Blocker = z.infer<typeof BlockerSchema>;

const GateSchema = z.strictObject({
  package: z.string().min(1),
  /** Renovate allowedVersions — 늘 계산으로 정한다(`<첫 막힌 버전`) */
  allowedVersions: z.string().regex(/^<\d+\.\d+\.\d+$/),
  blockers: z.array(BlockerSchema).min(1),
  reason: z.string().min(1).max(300),
  checkedAt: z.iso.date(),
});
export type Gate = z.infer<typeof GateSchema>;

export const GatesFileSchema = z.strictObject({ gates: z.array(GateSchema) });
export type GatesFile = z.infer<typeof GatesFileSchema>;

/** detect가 찾은, 관문이 필요해 보이는 의존성 */
export const CandidateSchema = z.strictObject({
  package: z.string().min(1),
  current: z.string().min(1),
  /** 막히는 가장 낮은 버전 */
  blockedAt: z.string().min(1),
  latest: z.string().min(1),
  blockers: z.array(BlockerSchema).min(1),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Claude의 판정. 관문을 둘지와 그 이유만 — 상한 값은 계산으로 정한다 */
export const ReviewSchema = z.array(
  z.strictObject({
    package: z.string().min(1),
    gate: z.boolean(),
    reason: z.string().min(1).max(300),
  }),
);
export type Review = z.infer<typeof ReviewSchema>;

/** 정식 릴리스만, 오름차순 */
export function stableVersions(versions: readonly string[]): string[] {
  return versions
    .filter(v => semver.valid(v) !== null && semver.prerelease(v) === null)
    .sort(semver.compare);
}

/**
 * from보다 높은 정식 릴리스 중, 막는 쪽 범위를 하나라도 벗어나는 가장 낮은 버전. 모두 만족하면 null.
 * 범위가 없으면(막는 쪽이 peer를 더는 두지 않으면) 막을 이유가 없다.
 */
export function firstBlocked(
  versions: readonly string[],
  from: string,
  ranges: readonly string[],
): string | null {
  if (ranges.length === 0) return null;
  for (const v of stableVersions(versions)) {
    if (!semver.gt(v, from)) continue;
    if (!ranges.every(r => semver.satisfies(v, r))) return v;
  }
  return null;
}

/** 관문 하나를 막는 쪽의 지금 범위로 다시 계산한다 — 풀렸으면 null, 아니면 상한·막는 쪽·확인 날짜를 갱신 */
export function recomputeGate(
  gate: Gate,
  input: {
    versions: readonly string[];
    current: string;
    blockers: readonly Blocker[];
    today: string;
  },
): Gate | null {
  const blockedAt = firstBlocked(
    input.versions,
    input.current,
    input.blockers.map(b => b.range),
  );
  if (blockedAt === null) return null;
  return {
    ...gate,
    allowedVersions: `<${blockedAt}`,
    blockers: blockersAt(input.blockers, blockedAt),
    checkedAt: input.today,
  };
}

/** 의존성 하나에서 관문 후보를 찾는다 — 막는 쪽 범위 밖의 새 버전이 있으면 */
export function detectCandidate(input: {
  package: string;
  current: string;
  versions: readonly string[];
  blockers: readonly Blocker[];
}): Candidate | null {
  const blockedAt = firstBlocked(
    input.versions,
    input.current,
    input.blockers.map(b => b.range),
  );
  const latest = stableVersions(input.versions).at(-1);
  if (blockedAt === null || latest === undefined) return null;
  return {
    package: input.package,
    current: input.current,
    blockedAt,
    latest,
    blockers: blockersAt(input.blockers, blockedAt),
  };
}

/** 그 버전을 실제로 막는 쪽만 남긴다 */
function blockersAt(blockers: readonly Blocker[], version: string): Blocker[] {
  return blockers.filter(b => !semver.satisfies(version, b.range));
}

/** Claude 판정을 반영한다. 후보에 없는 패키지는 거부한다(판정이 상한을 정하지 못하게) */
export function applyReview(
  file: GatesFile,
  candidates: readonly Candidate[],
  review: Review,
  today: string,
): GatesFile {
  const gates = [...file.gates];
  for (const r of review) {
    const candidate = candidates.find(c => c.package === r.package);
    if (candidate === undefined) {
      throw new Error(`후보에 없는 패키지를 판정했다: ${r.package}`);
    }
    if (!r.gate || gates.some(g => g.package === r.package)) continue;
    gates.push({
      package: candidate.package,
      allowedVersions: `<${candidate.blockedAt}`,
      blockers: candidate.blockers,
      reason: r.reason,
      checkedAt: today,
    });
  }
  return { gates: gates.sort((a, b) => a.package.localeCompare(b.package)) };
}

const RenovateSchema = z.looseObject({
  packageRules: z.array(z.looseObject({})).optional(),
});

/** renovate.json의 관문 규칙만 upgrade-gates.json에서 다시 만든다. 나머지 규칙·설정은 그대로 둔다 */
export function syncRenovate(
  renovate: unknown,
  file: GatesFile,
): Record<string, unknown> {
  const parsed = RenovateSchema.parse(renovate);
  const kept = (parsed.packageRules ?? []).filter(
    rule =>
      !(
        typeof rule['description'] === 'string' &&
        rule['description'].startsWith(GATE_PREFIX)
      ),
  );
  const generated = file.gates.map(g => ({
    description: `${GATE_PREFIX} ${g.package}: ${g.reason} — upgrade-gates.json에서 생성(손으로 고치지 않는다)`,
    matchPackageNames: [g.package],
    allowedVersions: g.allowedVersions,
  }));
  const packageRules = [...kept, ...generated];
  // 키 순서는 원본 객체에서 가져온다 — 파싱 결과는 스키마가 아는 키를 앞으로 옮겨, 파일 전체가 바뀐 것처럼 보인다
  const entries = Object.entries(
    z.record(z.string(), z.unknown()).parse(renovate),
  );
  return entries.some(([k]) => k === 'packageRules')
    ? Object.fromEntries(
        entries.map(([k, v]) => [k, k === 'packageRules' ? packageRules : v]),
      )
    : { ...Object.fromEntries(entries), packageRules };
}
