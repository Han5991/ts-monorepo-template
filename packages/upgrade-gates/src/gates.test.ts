import { describe, expect, it } from 'vitest';
import {
  applyReview,
  detectCandidate,
  firstBlocked,
  GATE_PREFIX,
  recomputeGate,
  stableVersions,
  syncRenovate,
  type Gate,
} from '#/gates.ts';

const VERSIONS = ['6.0.3', '6.1.0', '6.1.1', '7.0.0-rc', '7.0.2', '5.9.0'];

describe('stableVersions', () => {
  it('정식 릴리스만 오름차순으로', () => {
    expect(stableVersions(VERSIONS)).toEqual([
      '5.9.0',
      '6.0.3',
      '6.1.0',
      '6.1.1',
      '7.0.2',
    ]);
  });
});

describe('firstBlocked', () => {
  it('현재보다 높은 버전 중 범위를 처음 벗어나는 것', () => {
    expect(firstBlocked(VERSIONS, '6.0.3', ['>=4.8.4 <6.1.0'])).toBe('6.1.0');
  });

  it('막는 쪽 범위가 여럿이면 하나라도 벗어나면 막힌다', () => {
    expect(firstBlocked(VERSIONS, '6.0.3', ['<8', '<7'])).toBe('7.0.2');
  });

  it('모두 만족하거나 범위가 없으면 null — 막을 이유가 없다', () => {
    expect(firstBlocked(VERSIONS, '6.0.3', ['>=6'])).toBeNull();
    expect(firstBlocked(VERSIONS, '6.0.3', [])).toBeNull();
  });
});

const TS_GATE: Gate = {
  package: 'typescript',
  allowedVersions: '<6.1.0',
  blockers: [{ package: 'typescript-eslint', range: '>=4.8.4 <6.1.0' }],
  reason: 'typescript-eslint가 아직 지원하지 않는다',
  checkedAt: '2026-11-01',
};

describe('recomputeGate', () => {
  it('막는 쪽이 넓어지면 상한을 올린다', () => {
    expect(
      recomputeGate(TS_GATE, {
        versions: VERSIONS,
        current: '6.0.3',
        blockers: [{ package: 'typescript-eslint', range: '>=4.8.4 <7.0.0' }],
        today: '2026-11-09',
      }),
    ).toMatchObject({ allowedVersions: '<7.0.2', checkedAt: '2026-11-09' });
  });

  it('모든 새 버전을 지원하면 관문을 푼다(null)', () => {
    expect(
      recomputeGate(TS_GATE, {
        versions: VERSIONS,
        current: '6.0.3',
        blockers: [{ package: 'typescript-eslint', range: '>=4.8.4 <8' }],
        today: '2026-11-09',
      }),
    ).toBeNull();
  });
});

describe('detectCandidate', () => {
  it('막힌 버전과, 그 버전을 실제로 막는 쪽만 남긴다', () => {
    expect(
      detectCandidate({
        package: 'typescript',
        current: '6.0.3',
        versions: VERSIONS,
        blockers: [
          { package: 'typescript-eslint', range: '<6.1.0' },
          { package: 'other', range: '>=5' },
        ],
      }),
    ).toEqual({
      package: 'typescript',
      current: '6.0.3',
      blockedAt: '6.1.0',
      latest: '7.0.2',
      blockers: [{ package: 'typescript-eslint', range: '<6.1.0' }],
    });
  });
});

describe('applyReview', () => {
  const candidate = {
    package: 'react',
    current: '19.3.1',
    blockedAt: '20.0.0',
    latest: '20.1.0',
    blockers: [{ package: 'some-ui', range: '^19' }],
  };

  it('관문을 두기로 한 후보만, 상한은 계산값으로 더한다', () => {
    expect(
      applyReview(
        { gates: [] },
        [candidate],
        [{ package: 'react', gate: true, reason: 'some-ui가 19만 지원' }],
        '2026-11-09',
      ).gates,
    ).toEqual([
      {
        package: 'react',
        allowedVersions: '<20.0.0',
        blockers: candidate.blockers,
        reason: 'some-ui가 19만 지원',
        checkedAt: '2026-11-09',
      },
    ]);
  });

  it('두지 않기로 한 후보는 더하지 않고, 후보에 없는 패키지 판정은 거부한다', () => {
    expect(
      applyReview(
        { gates: [] },
        [candidate],
        [{ package: 'react', gate: false, reason: '실제로는 호환된다' }],
        '2026-11-09',
      ).gates,
    ).toEqual([]);
    expect(() =>
      applyReview(
        { gates: [] },
        [candidate],
        [{ package: 'lodash', gate: true, reason: 'x' }],
        '2026-11-09',
      ),
    ).toThrow('후보에 없는');
  });
});

describe('syncRenovate', () => {
  it('관문 규칙만 갈아 끼우고 다른 규칙·설정은 그대로 둔다', () => {
    const renovate = {
      extends: ['config:recommended'],
      packageRules: [
        { description: '손으로 쓴 규칙', matchManagers: ['github-actions'] },
        {
          description: `${GATE_PREFIX} 옛 관문`,
          matchPackageNames: ['old'],
          allowedVersions: '<1.0.0',
        },
      ],
    };
    const synced = syncRenovate(renovate, { gates: [TS_GATE] });
    expect(synced['extends']).toEqual(['config:recommended']);
    expect(synced['packageRules']).toEqual([
      { description: '손으로 쓴 규칙', matchManagers: ['github-actions'] },
      expect.objectContaining({
        matchPackageNames: ['typescript'],
        allowedVersions: '<6.1.0',
      }),
    ]);
  });
});
