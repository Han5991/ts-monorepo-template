/**
 * 문서·주석에 백틱으로 적은 저장소 경로가 실제로 있는지 본다 — 파일·폴더를 옮기거나 지워도 가리키는 글이 조용히 낡지 않게.
 * 저장소 루트의 폴더(REPO_PATH_PREFIXES)로 시작하는 경로만 보고, 백틱 밖의 맨 경로·마크다운 링크는 보지 않는다.
 * glob·자리표시·생략(별표·꺾쇠·중괄호·대괄호·물음표·세로줄·달러·말줄임)이 든 것도 보지 않는다. 확장자를 뺀 경로는 그 이름에
 * 확장자 하나를 붙인 파일이 있으면 된다(이름이 같은 테스트 파일로는 통과하지 않는다).
 */

/** 저장소 경로로 보는 접두사 */
export const REPO_PATH_PREFIXES = [
  'apps/',
  'packages/',
  'docs/',
  'scripts/',
  '.github/',
  '.claude/',
] as const;

export interface SourceText {
  /** 저장소 루트 기준 경로 */
  readonly path: string;
  readonly text: string;
}

/** 경로 뒤에 붙는 위치 표시 — 콜론 줄·열(`:12`·`:12:5`·`:12-30`)과 줄 앵커(`#L3`·`#L3-L9`) */
const POSITION = /(?::\d+)+(?:-\d+)?$|#L\d+(?:-L?\d+)?$/;
/** 경로가 아니라 자리표시·glob·생략이라는 표시 */
const PLACEHOLDER = /[*<>{}[\]?|$…]|\.\.\./;

/** 글 하나에서 백틱 안의 저장소 경로들(위치 표시는 뗀다) */
export function repoPathsIn(text: string): string[] {
  const paths: string[] = [];
  // 공백이 든 백틱 글(명령 한 줄)도 짝을 맞춰 넘긴다 — 공백을 빼고 짝을 찾으면 그 뒤의 백틱 짝이 어긋나 경로를 놓친다
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1] ?? '';
    if (/\s/.test(span)) continue;
    const token = span.replace(POSITION, '');
    if (!REPO_PATH_PREFIXES.some(prefix => token.startsWith(prefix))) continue;
    // 접두사 하나뿐인 것은 경로가 아니라 분류 이름이다 — init이 그 폴더를 지워도 글은 맞다
    if (REPO_PATH_PREFIXES.some(prefix => prefix === token)) continue;
    if (PLACEHOLDER.test(token)) continue;
    paths.push(token);
  }
  return paths;
}

/** 이 경로가 있는가 — 파일 그대로, 폴더(그 아래 파일이 있다), 또는 확장자 하나만 뺀 파일 이름 */
export function pathExists(files: readonly string[], target: string): boolean {
  const dir = target.endsWith('/') ? target : `${target}/`;
  const withExtension = `${target}.`;
  return files.some(
    file =>
      file === target ||
      file.startsWith(dir) ||
      (file.startsWith(withExtension) &&
        !file.slice(withExtension.length).includes('.')),
  );
}

/** 없는 곳을 가리키는 참조들 — "파일: 경로 — 없다"(같은 글의 같은 경로는 한 번) */
export function missingDocPaths(
  sources: readonly SourceText[],
  files: readonly string[],
): string[] {
  const problems = new Set<string>();
  for (const source of sources) {
    for (const target of repoPathsIn(source.text)) {
      if (!pathExists(files, target)) {
        problems.add(`${source.path}: \`${target}\` — 없다`);
      }
    }
  }
  return [...problems].sort();
}
