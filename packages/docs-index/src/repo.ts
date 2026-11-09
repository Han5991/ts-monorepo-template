import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAdr, renderIndex, replaceIndex, validateAdrs } from '#/adr.ts';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const ADR_DIR = 'docs/adr';
export const AGENTS_FILE = 'AGENTS.md';

/**
 * 색인 대상은 git이 추적하는(index에 있는) 파일만이다 — add하지 않은 초안이 색인과 커밋에 섞이지 않게.
 * 커밋 훅에서는 staged 된 새 ADR이 index에 있으므로 함께 들어간다.
 */
export function trackedFiles(root: string, dir: string): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--', dir], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(line => line !== '');
}

/**
 * README.md만 설명서이고 나머지는 전부 ADR이어야 한다 — 이름이 틀린 파일을 조용히 건너뛰지 않는다.
 * 색인 링크가 `${dir}/파일`이라 하위 폴더는 받지 않는다.
 */
export function adrPaths(paths: readonly string[], dir: string): string[] {
  const nested = paths.find(p => path.posix.dirname(p) !== dir);
  if (nested !== undefined) {
    throw new Error(`${nested}: ADR은 ${dir} 바로 아래에만 둔다`);
  }
  return paths.filter(p => p !== `${dir}/README.md`);
}

/** 현재 AGENTS.md와, ADR에서 생성한 색인을 넣은 AGENTS.md */
export function agentsIndex(
  root: string,
  paths: readonly string[],
): { current: string; expected: string } {
  const adrs = adrPaths(paths, ADR_DIR).map(p =>
    parseAdr(path.basename(p), readFileSync(path.join(root, p), 'utf8')),
  );
  validateAdrs(adrs);

  const current = readFileSync(path.join(root, AGENTS_FILE), 'utf8');
  return {
    current,
    expected: replaceIndex(current, renderIndex(adrs, ADR_DIR)),
  };
}
