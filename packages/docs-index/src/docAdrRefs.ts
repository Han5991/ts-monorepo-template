/**
 * 문서·주석이 "ADR NNNN"으로 가리킨 결정이 실제로 있는지 본다 — 결정을 지우거나 대체해도 가리키는 글이 조용히 낡지 않게.
 * `docs/adr` 밖(코드 주석·AGENTS.md·README)에서는 대체된 결정도 걸린다: 그 결정을 근거로 든 곳을 다시 보게 하려는 것이다.
 * 결정 기록끼리는 옛 결정을 가리켜도 된다(대체한 결정이 대체된 결정을 말한다).
 * "ADR" 뒤에 번호를 적은 것만 보고(`·`로 이은 번호 포함), 번호만 적은 것과 색인의 링크는 보지 않는다.
 */
import type { Adr } from '#/adr.ts';
import type { SourceText } from '#/docPaths.ts';

/** 글 하나가 "ADR NNNN"으로 가리킨 결정 번호들(같은 번호는 한 번) */
export function adrRefsIn(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/ADR\s+(\d{4}(?:·\d{4})*)(?!\d)/g)) {
    for (const number of (match[1] ?? '').split('·')) refs.add(number);
  }
  return [...refs];
}

/** 없는 결정이나 (결정 기록 밖에서) 대체된 결정을 가리키는 참조들 — "파일: ADR 번호 — 이유" */
export function adrRefProblems(
  sources: readonly SourceText[],
  adrs: readonly Adr[],
  adrDir: string,
): string[] {
  const byNumber = new Map(adrs.map(adr => [adr.number, adr]));
  const problems: string[] = [];
  for (const source of sources) {
    for (const number of adrRefsIn(source.text)) {
      const adr = byNumber.get(number);
      if (adr === undefined) {
        problems.push(`${source.path}: ADR ${number} — 없는 결정이다`);
      } else if (
        adr.status === 'superseded' &&
        !source.path.startsWith(`${adrDir}/`)
      ) {
        problems.push(
          `${source.path}: ADR ${number} — 대체된 결정이다. ADR ${adr.supersededBy}에 맞는지 보고 고친다`,
        );
      }
    }
  }
  return problems.sort();
}
