import type { Adr } from '#/adr.ts';
import { adrRefProblems, adrRefsIn } from '#/docAdrRefs.ts';
import {
  ADR_DIR,
  docSources,
  readAdrs,
  REPO_ROOT,
  trackedFiles,
} from '#/repo.ts';
import { describe, expect, it } from 'vitest';

// 이 파일은 예시 번호를 글로 담고 있어 저장소 검사에서 뺀다
const SELF = 'packages/docs-index/src/docAdrRefs.test.ts';

describe('저장소의 문서·주석이 가리키는 결정', () => {
  it('"ADR 번호"로 가리킨 결정이 있고, docs/adr 밖에서는 대체되지 않은 결정이다 — 결정을 대체했으면 그것을 근거로 든 곳도 다시 본다', () => {
    const sources = docSources(REPO_ROOT, trackedFiles(REPO_ROOT, '.'), [SELF]);
    const adrs = readAdrs(REPO_ROOT, trackedFiles(REPO_ROOT, ADR_DIR));
    expect(sources.length).toBeGreaterThan(0);
    expect(adrRefProblems(sources, adrs, ADR_DIR)).toEqual([]);
  });
});

describe('adrRefsIn', () => {
  it('"ADR" 뒤의 번호를 꺼낸다 — ·로 이은 번호와 줄이 바뀐 번호도, 같은 번호는 한 번', () => {
    expect(
      adrRefsIn('막는다(ADR 0007·0016). ADR 0001과 같다(ADR\n0003, ADR 0001).'),
    ).toEqual(['0007', '0016', '0001', '0003']);
  });

  it('번호만 적은 것, 색인 링크, 네 자리가 아닌 수, 쉼표 뒤의 다른 수는 꺼내지 않는다', () => {
    expect(
      adrRefsIn(
        '(0001) [0002](docs/adr/0002-x.md) ADR 12345 ADR 004 ADR 0005, 2026-11-21',
      ),
    ).toEqual(['0005']);
  });
});

describe('adrRefProblems', () => {
  const base = { file: 'x.md', title: '제목', date: '2026-01-01' };
  const adrs: Adr[] = [
    { ...base, number: '0001', status: 'accepted' },
    { ...base, number: '0002', status: 'superseded', supersededBy: '0001' },
  ];

  it('있는 결정을 가리키면 문제가 없다 — 결정 기록끼리는 대체된 결정을 가리켜도 된다', () => {
    expect(
      adrRefProblems(
        [
          { path: 'README.md', text: 'ADR 0001' },
          { path: 'docs/adr/0001-x.md', text: 'ADR 0002를 대체한다' },
        ],
        adrs,
        'docs/adr',
      ),
    ).toEqual([]);
  });

  it('양성 대조 — 없는 결정과, 결정 기록 밖에서 가리킨 대체된 결정을 어느 글의 어느 번호인지 알린다', () => {
    expect(
      adrRefProblems(
        [
          { path: 'src/a.ts', text: '// ADR 0001·0002, ADR 0009' },
          { path: 'docs/adr/0001-x.md', text: 'ADR 0002 ADR 0009' },
        ],
        adrs,
        'docs/adr',
      ),
    ).toEqual([
      'docs/adr/0001-x.md: ADR 0009 — 없는 결정이다',
      'src/a.ts: ADR 0002 — 대체된 결정이다. ADR 0001에 맞는지 보고 고친다',
      'src/a.ts: ADR 0009 — 없는 결정이다',
    ]);
  });
});
