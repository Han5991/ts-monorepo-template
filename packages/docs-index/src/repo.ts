import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  parseAdr,
  renderIndex,
  replaceIndex,
  validateAdrs,
  type Adr,
} from '#/adr.ts';
import type { Workspace, Workspaces } from '#/docCommands.ts';
import type { SourceText } from '#/docPaths.ts';

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
  const current = readFileSync(path.join(root, AGENTS_FILE), 'utf8');
  return {
    current,
    expected: replaceIndex(
      current,
      renderIndex(readAdrs(root, paths), ADR_DIR),
    ),
  };
}

/** docs/adr의 결정들(형식·번호·대체 관계를 검사한 것) */
export function readAdrs(root: string, paths: readonly string[]): Adr[] {
  const adrs = adrPaths(paths, ADR_DIR).map(p =>
    parseAdr(path.basename(p), readFileSync(path.join(root, p), 'utf8')),
  );
  validateAdrs(adrs);
  return adrs;
}

const TEXT_FILE = /\.(md|ts|mts|tsx|ya?ml|json|sh|py)$/;

/**
 * 가리키는 것이 실제로 있는지 볼 글들(문서·코드·설정). 보지 않는 것 — CLAUDE.md는 AGENTS.md를 가리키는 링크라 같은 글을 두 번
 * 본다. .claude/skills/ 아래는 원본 그대로 두는 남의 스킬(scripts/init.ts가 손대지 않는다)이라 그 안의 참조는 원본 저장소의 것이다.
 * `except`에는 예시 참조를 글로 담은 파일(그 검사의 테스트 파일)을 넘긴다.
 */
export function docSources(
  root: string,
  files: readonly string[],
  except: readonly string[],
): SourceText[] {
  return files
    .filter(
      file =>
        TEXT_FILE.test(file) &&
        file !== 'CLAUDE.md' &&
        !file.startsWith('.claude/skills/') &&
        !except.includes(file),
    )
    .map(file => ({
      path: file,
      text: readFileSync(path.join(root, file), 'utf8'),
    }));
}

const PackageJson = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).default({}),
});

/** 프로젝트 폴더 하나의 package.json과 설치한 도구 */
function readWorkspace(dir: string): Workspace {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(dir, 'package.json'), 'utf8'),
  );
  const json = PackageJson.parse(raw);
  const bin = path.join(dir, 'node_modules', '.bin');
  return {
    name: json.name,
    scripts: Object.keys(json.scripts),
    // .bin이 없으면(실행 파일을 주는 의존성이 없거나 설치 전) 부를 도구도 없다 — 검사가 엄격해질 뿐 느슨해지지 않는다
    bins: existsSync(bin) ? readdirSync(bin) : [],
  };
}

/** pnpm ls --json이 내는 프로젝트 — 쓰는 것은 경로뿐이다 */
const PnpmProjects = z.array(z.object({ path: z.string() }));

/** pnpm을 돌려 JSON 출력을 읽는다 — 다른 글이 섞여 읽지 못하면 무엇이 왔는지 남긴다 */
function pnpmJson(args: readonly string[], cwd: string): unknown {
  const stdout = execFileSync('pnpm', args, { cwd, encoding: 'utf8' });
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `pnpm ${args.join(' ')}의 출력이 JSON이 아니다: ${stdout.slice(0, 200)}`,
      { cause: error },
    );
  }
}

/**
 * 루트와 워크스페이스 패키지. 패키지는 pnpm이 pnpm-workspace.yaml의 packages로 찾은 프로젝트다 — glob을 여기에 옮겨 적으면
 * 그 파일이 바뀔 때 조용히 어긋난다. --depth -1은 의존성 없이 프로젝트만 낸다(pnpm 12.18.0의 pnpm help list, 확인 2026-11-21).
 */
export function readWorkspaces(root: string): Workspaces {
  // pnpm은 심볼릭 링크를 거쳐 들어가도 링크를 푼 경로를 낸다(pnpm 12.18.0으로 확인, 2026-11-21) — 루트도 같은 표기로 바꿔야
  // 패키지와 가려진다
  const rootDir = realpathSync(root);
  const listed = pnpmJson(
    ['ls', '--recursive', '--depth', '-1', '--json'],
    rootDir,
  );
  return {
    root: readWorkspace(rootDir),
    packages: PnpmProjects.parse(listed)
      .map(project => project.path)
      .filter(dir => dir !== rootDir)
      .map(readWorkspace),
  };
}
