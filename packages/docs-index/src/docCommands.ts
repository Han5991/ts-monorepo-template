/**
 * 문서·주석에 백틱으로 적은 pnpm 명령이 실제로 도는지 본다 — 스크립트 이름을 바꾸거나 지워도 안내하는 글이 조용히 낡지 않게.
 * 보는 글: `.md`는 전부, 그 밖의 파일은 주석 줄만(문자열 데이터에 든 명령은 안내가 아니다).
 * 보는 것: 첫 낱말이 pnpm 자체 명령이거나, package.json의 스크립트이거나, 설치한 도구의 실행 이름인가. `--filter`가 있으면 그
 * 프로젝트(루트도 고를 수 있다)에서 본다. turbo의 작업 이름 — `turbo run` 뒤나 run 없이 받는 `turbo lint`의 첫 옵션 앞 낱말 — 은
 * 어느 워크스페이스 패키지엔가 있는 스크립트여야 한다. 옵션 뒤의 낱말은 옵션 값(`--filter @x/api`)인지 작업인지 가리지 못해 보지
 * 않는다 — 작업을 옵션 뒤에만 적으면 거부한다. 그 밖의 인자는 보지 않는다.
 */
import type { SourceText } from '#/docPaths.ts';

/** package.json 하나에서 명령 검사에 쓰는 것 */
export interface Workspace {
  /** package.json의 name — 루트는 없어도 된다 */
  readonly name: string | undefined;
  readonly scripts: readonly string[];
  /**
   * 설치한 도구의 실행 이름(그 패키지의 `node_modules/.bin`) — 패키지 이름이 아니다. typescript를 깔면 pnpm tsc는 돌고
   * pnpm typescript는 "Command not found"다(pnpm 12.18.0으로 실행해 확인, 2026-11-21).
   */
  readonly bins: readonly string[];
}

export interface Workspaces {
  readonly root: Workspace;
  /** 루트를 뺀 워크스페이스 프로젝트 */
  readonly packages: readonly Workspace[];
}

/**
 * pnpm 자체 명령 가운데 글에서 쓰는 것. pnpm의 명령 목록은 가져올 수 없어 손으로 적는다 — 없는 것을 글에 쓰면 이 검사가
 * 실패하니 그때 더한다(스크립트 이름을 잘못 적은 것과 가려 보고).
 */
const PNPM_COMMANDS = ['install', 'dlx'];

const COMMENT_LINE = {
  slash: /^\s*(\/\/|\/\*|\*)/,
  hash: /^\s*#/,
};

/** 글에서 사람이 읽는 안내인 부분 — `.md`는 전부, 그 밖의 파일은 주석으로 시작하는 줄 */
export function proseOf(source: SourceText): string {
  if (source.path.endsWith('.md')) return source.text;
  const comment = /\.(ya?ml|sh|py)$/.test(source.path)
    ? COMMENT_LINE.hash
    : COMMENT_LINE.slash;
  return source.text
    .split('\n')
    .filter(line => comment.test(line))
    .join('\n');
}

/** 글 하나에서 백틱 안의, pnpm으로 시작하는 명령들(같은 명령은 한 번) */
export function pnpmCommandsIn(text: string): string[] {
  const commands = new Set<string>();
  for (const match of text.matchAll(/`(pnpm\s[^`\n]+)`/g)) {
    commands.add((match[1] ?? '').trim());
  }
  return [...commands];
}

/** 이 명령이 돌지 않는 이유. 돌면 undefined */
export function commandProblem(
  command: string,
  workspaces: Workspaces,
): string | undefined {
  const words = command.split(/\s+/).slice(1);
  let target = workspaces.root;
  let where = '루트 package.json';

  const first = words[0] ?? '';
  if (first === '--filter' || first.startsWith('--filter=')) {
    const name =
      first === '--filter' ? words[1] : first.slice('--filter='.length);
    // 이름 없이 찾으면 name 필드가 없는 package.json과 맞는다
    if (name === undefined || name === '') return '패키지 이름이 없다';
    // 루트도 워크스페이스 프로젝트라 이름으로 고를 수 있다
    const found = [workspaces.root, ...workspaces.packages].find(
      pkg => pkg.name === name,
    );
    if (found === undefined) {
      return `워크스페이스에 없는 패키지다: ${name}`;
    }
    target = found;
    where = `${name}의 package.json`;
    words.splice(0, first === '--filter' ? 2 : 1);
  } else if (first.startsWith('-')) {
    return `이 검사가 모르는 옵션이다: ${first}`;
  }

  // run을 붙이면 스크립트만 돌린다. 붙이지 않으면 스크립트가 없을 때 pnpm 자체 명령이나 설치한 도구를 찾는다. 도구는 고른
  // 패키지의 .bin 다음에 루트의 .bin에서도 찾는다 — pnpm이 둘 다 PATH에 붙인다(pnpm 12.18.0으로 확인, 2026-11-21). 루트의
  // 스크립트는 고른 패키지에서 돌지 않는다
  const viaRun = words[0] === 'run';
  const [head, ...rest] = viaRun ? words.slice(1) : words;
  if (head === undefined) return '실행할 것이 없다';
  if (target.scripts.includes(head)) return undefined;
  const known =
    !viaRun &&
    (PNPM_COMMANDS.includes(head) ||
      target.bins.includes(head) ||
      workspaces.root.bins.includes(head));
  if (!known) return `${where}에 없는 스크립트다: ${head}`;
  return head === 'turbo' ? turboTaskProblem(rest, workspaces) : undefined;
}

/**
 * turbo 뒤의 낱말에서 작업 이름이 어느 패키지에도 없는 문제. 작업은 `turbo run` 뒤나, run 없이 받는 `turbo lint`의 첫 옵션 앞
 * 낱말이다 — 띄어 쓴 옵션 값(`--concurrency 1`)을 작업으로 세지 않는다. run 말고는 turbo의 하위 명령(prune·watch 등)도 작업으로
 * 보니, 글에 쓰게 되면 PNPM_COMMANDS처럼 그 이름을 적어 가려 본다.
 */
function turboTaskProblem(
  args: readonly string[],
  workspaces: Workspaces,
): string | undefined {
  const viaRun = args[0] === 'run';
  const words = viaRun ? args.slice(1) : args;
  const firstOption = words.findIndex(word => word.startsWith('-'));
  const tasks = firstOption === -1 ? words : words.slice(0, firstOption);
  if (tasks.length === 0) {
    // 옵션만 주면 turbo 자체를 부른 것이다(`turbo --version`). run을 붙였거나 옵션 뒤에 낱말이 있으면 작업을 적으려 한 것이다
    const meantTasks = viaRun || words.some(word => !word.startsWith('-'));
    return meantTasks
      ? `${viaRun ? 'turbo run' : 'turbo'} 바로 뒤에 작업 이름이 없다(작업은 옵션 앞에 적는다)`
      : undefined;
  }
  // 루트의 스크립트는 작업이 아니다 — turbo는 루트에만 있는 스크립트를 "Could not find task"로 거부한다(turbo 2.11.11로 확인,
  // 2026-11-21). turbo.json에 루트 작업(//#)을 두게 되면 여기서도 본다
  const missing = tasks.filter(
    task => !workspaces.packages.some(pkg => pkg.scripts.includes(task)),
  );
  return missing.length > 0
    ? `어느 패키지에도 없는 작업이다: ${missing.join(', ')}`
    : undefined;
}

/** 돌지 않는 명령을 적은 곳들 — "파일: `명령` — 이유" */
export function commandProblems(
  sources: readonly SourceText[],
  workspaces: Workspaces,
): string[] {
  const problems: string[] = [];
  for (const source of sources) {
    for (const command of pnpmCommandsIn(proseOf(source))) {
      const problem = commandProblem(command, workspaces);
      if (problem !== undefined) {
        problems.push(`${source.path}: \`${command}\` — ${problem}`);
      }
    }
  }
  return problems.sort();
}
