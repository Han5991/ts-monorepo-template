import { readFileSync } from 'node:fs';
import path from 'node:path';
import { missingDocPaths, pathExists, repoPathsIn } from '#/docPaths.ts';
import { REPO_ROOT, trackedFiles } from '#/repo.ts';
import { describe, expect, it } from 'vitest';

// 이 파일은 예시 경로를 글로 담고 있어 저장소 검사에서 뺀다
const SELF = 'packages/docs-index/src/docPaths.test.ts';
const TEXT_FILE = /\.(md|ts|mts|tsx|ya?ml|json|sh|py)$/;
/**
 * 검사하지 않는 글 — CLAUDE.md는 AGENTS.md를 가리키는 링크라 같은 글을 두 번 본다. `.claude/skills/`는 원본 그대로 두는
 * 남의 스킬(scripts/init.ts가 손대지 않는다)이라 그 안의 경로는 원본 저장소의 것이다.
 */
function scanned(file: string): boolean {
  return (
    TEXT_FILE.test(file) &&
    file !== SELF &&
    file !== 'CLAUDE.md' &&
    !file.startsWith('.claude/skills/')
  );
}

describe('저장소의 문서·주석 경로', () => {
  it('백틱으로 적은 저장소 경로가 모두 있다 — 파일을 옮기거나 지웠으면 가리키는 글도 고친다', () => {
    const files = trackedFiles(REPO_ROOT, '.');
    const sources = files.filter(scanned).map(file => ({
      path: file,
      text: readFileSync(path.join(REPO_ROOT, file), 'utf8'),
    }));
    expect(sources.length).toBeGreaterThan(0);
    expect(missingDocPaths(sources, files)).toEqual([]);
  });
});

describe('repoPathsIn', () => {
  it('저장소 폴더로 시작하는 백틱 경로만 꺼낸다', () => {
    expect(
      repoPathsIn(
        '`packages/a/x.ts` · `docs/adr/` · `zod` · `#/task/task.ts` · `apps/api` · `scripts/init.ts` · `.github/workflows/ci.yml` · `.claude/settings.json`',
      ),
    ).toEqual([
      'packages/a/x.ts',
      'docs/adr/',
      'apps/api',
      'scripts/init.ts',
      '.github/workflows/ci.yml',
      '.claude/settings.json',
    ]);
  });

  it('줄·열·범위·줄 앵커 표시를 뗀다', () => {
    expect(
      repoPathsIn(
        '`packages/a.ts:12` `packages/b.ts:12:5` `packages/c.ts:3-9` `packages/d.ts#L3` `packages/e.ts#L3-L9`',
      ),
    ).toEqual([
      'packages/a.ts',
      'packages/b.ts',
      'packages/c.ts',
      'packages/d.ts',
      'packages/e.ts',
    ]);
  });

  it('공백이 든 백틱 글 바로 뒤의 경로도 놓치지 않는다 — 백틱 짝이 어긋나지 않는다', () => {
    expect(repoPathsIn('`pnpm gates sync`·`packages/gone`')).toEqual([
      'packages/gone',
    ]);
  });

  it('접두사 하나뿐인 분류 이름은 경로로 보지 않는다', () => {
    expect(repoPathsIn('`apps/`·`scripts/`·`docs/adr`')).toEqual(['docs/adr']);
  });

  it('glob·자리표시·생략이 든 경로는 보지 않는다', () => {
    expect(
      repoPathsIn(
        [
          '`packages/*/src`',
          '`apps/<앱>/src`',
          '`docs/{a,b}.md`',
          '`packages/${name}`',
          '`docs/…`',
          '`docs/...`',
          '`apps/api/src/[name].ts`',
          '`docs/adr/000?-x.md`',
          '`packages/a|b`',
        ].join(' '),
      ),
    ).toEqual([]);
  });
});

describe('pathExists', () => {
  const files = [
    'packages/domain/src/task/task.ts',
    'packages/domain/src/order/order.test.ts',
    'docs/adr/0001-x.md',
  ];

  it('파일·폴더·확장자 하나를 뺀 이름은 있으면 통과한다', () => {
    expect(pathExists(files, 'packages/domain/src/task/task.ts')).toBe(true);
    expect(pathExists(files, 'packages/domain/src/task')).toBe(true);
    expect(pathExists(files, 'packages/domain/src/task/task')).toBe(true);
  });

  it('이름이 앞만 같은 것·같은 이름의 테스트 파일로는 통과하지 않는다', () => {
    expect(pathExists(files, 'packages/domain/src/ta')).toBe(false);
    expect(pathExists(files, 'packages/domain/src/order/order')).toBe(false);
  });
});

describe('missingDocPaths', () => {
  it('양성 대조 — 없는 곳을 가리키면 어느 글의 어느 경로인지 한 번씩 알린다', () => {
    expect(
      missingDocPaths(
        [
          {
            path: 'README.md',
            text: '`docs/adr/0001-x.md`·`packages/gone.ts`·`packages/gone.ts`',
          },
          { path: 'AGENTS.md', text: '`apps/web/src/app.ts`' },
        ],
        ['docs/adr/0001-x.md'],
      ),
    ).toEqual([
      'AGENTS.md: `apps/web/src/app.ts` — 없다',
      'README.md: `packages/gone.ts` — 없다',
    ]);
  });
});
