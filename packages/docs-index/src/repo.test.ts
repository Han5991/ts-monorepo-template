import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { commandProblem } from '#/docCommands.ts';
import {
  ADR_DIR,
  adrPaths,
  AGENTS_FILE,
  agentsIndex,
  readWorkspaces,
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

describe('readWorkspaces', () => {
  // pnpm이 실제로 읽는 임시 워크스페이스. 패키지 glob을 이 저장소의 것과 일부러 다르게 둔다
  const base = mkdtempSync(path.join(tmpdir(), 'docs-index-'));
  const root = path.join(base, 'workspace');
  const files = {
    'pnpm-workspace.yaml': "packages:\n  - 'tools/*'\n  - '!tools/skipped'\n",
    'package.json': JSON.stringify({
      name: 'fixture',
      devDependencies: { typescript: '1.0.0' },
    }),
    // pnpm install이 typescript를 깔며 만드는 실행 파일
    'node_modules/.bin/tsc': '',
    'node_modules/.bin/tsserver': '',
    'tools/kept/package.json': JSON.stringify({ name: '@f/kept' }),
    'tools/skipped/package.json': JSON.stringify({ name: '@f/skipped' }),
    'apps/stray/package.json': JSON.stringify({ name: '@f/stray' }),
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const packageNames = (dir: string) =>
    readWorkspaces(dir).packages.map(pkg => pkg.name);

  it('패키지는 pnpm-workspace.yaml의 glob이 고른 프로젝트다 — apps·packages를 손으로 적은 목록이 아니다', () => {
    expect(packageNames(root)).toContain('@f/kept');
  });

  it('glob 밖이거나 빼는 패턴(!)에 걸린 package.json은 패키지가 아니다', () => {
    expect(packageNames(root)).toEqual(['@f/kept']);
  });

  it('심볼릭 링크를 거쳐 받은 루트도 루트로 가린다 — 패키지에 섞지 않는다', () => {
    const link = path.join(base, 'link');
    symlinkSync(root, link);
    expect(packageNames(link)).toEqual(['@f/kept']);
  });

  it('도구는 node_modules/.bin의 실행 이름이다 — typescript를 깔면 pnpm tsc가 돈다', () => {
    const workspaces = readWorkspaces(root);
    expect(workspaces.root.bins.toSorted()).toEqual(['tsc', 'tsserver']);
    expect(commandProblem('pnpm tsc --noEmit', workspaces)).toBeUndefined();
  });

  it('실행 이름이 아닌 패키지 이름으로는 돌지 않는다 — pnpm typescript는 거부한다', () => {
    expect(commandProblem('pnpm typescript', readWorkspaces(root))).toBe(
      '루트 package.json에 없는 스크립트다: typescript',
    );
  });
});
