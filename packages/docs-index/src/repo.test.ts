import { describe, expect, it } from 'vitest';
import {
  ADR_DIR,
  adrPaths,
  AGENTS_FILE,
  agentsIndex,
  REPO_ROOT,
  trackedFiles,
} from '#/repo.ts';

describe('저장소의 AGENTS.md 결정 색인', () => {
  it('git이 추적하는 docs/adr와 일치한다 — 어긋나면 `pnpm docs:index`를 실행한다', () => {
    const { current, expected } = agentsIndex(
      REPO_ROOT,
      trackedFiles(REPO_ROOT, ADR_DIR),
    );
    expect(current, `${AGENTS_FILE} 색인이 docs/adr와 다르다`).toBe(expected);
  });
});

describe('adrPaths', () => {
  it('README.md만 빼고 나머지는 모두 ADR로 넘긴다(이름이 틀리면 파싱에서 실패하게)', () => {
    expect(
      adrPaths(
        ['docs/adr/0001-a.md', 'docs/adr/README.md', 'docs/adr/draft.md'],
        'docs/adr',
      ),
    ).toEqual(['docs/adr/0001-a.md', 'docs/adr/draft.md']);
  });

  it('하위 폴더의 파일은 거부한다 — 색인 링크가 깨지지 않게', () => {
    expect(() => adrPaths(['docs/adr/old/0003-a.md'], 'docs/adr')).toThrow();
  });
});
