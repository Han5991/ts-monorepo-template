import { z } from 'zod';

export const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
export const INDEX_START = '<!-- adr-index:start -->';
export const INDEX_END = '<!-- adr-index:end -->';

const AdrNumber = z.string().regex(/^\d{4}$/);

const Frontmatter = z.discriminatedUnion('status', [
  z.strictObject({ date: z.iso.date(), status: z.literal('accepted') }),
  z.strictObject({
    date: z.iso.date(),
    status: z.literal('superseded'),
    superseded_by: AdrNumber,
  }),
]);

interface AdrBase {
  number: string;
  file: string;
  title: string;
  date: string;
}

export type Adr =
  | (AdrBase & { status: 'accepted' })
  | (AdrBase & { status: 'superseded'; supersededBy: string });

export function parseAdr(file: string, raw: string): Adr {
  // core.autocrlf 체크아웃에서도 같은 결과가 나오게 줄바꿈을 맞춘다
  const text = raw.replace(/\r\n/g, '\n');
  const number = ADR_FILE.exec(file)?.[1];
  if (number === undefined) {
    throw new Error(`${file}: 파일 이름은 NNNN-영문-슬러그.md`);
  }
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm?.[1]) throw new Error(`${file}: 맨 앞에 --- frontmatter --- 가 없다`);

  const fields: Record<string, string> = {};
  for (const line of fm[1].split('\n')) {
    const kv = /^([a-z_]+): (.+)$/.exec(line);
    if (!kv?.[1] || !kv[2]) {
      throw new Error(`${file}: frontmatter 줄 형식은 "키: 값" — ${line}`);
    }
    fields[kv[1]] = kv[2];
  }
  const meta = Frontmatter.safeParse(fields);
  if (!meta.success) {
    throw new Error(`${file}: frontmatter — ${z.prettifyError(meta.error)}`);
  }

  const title = /^# (.+)$/
    .exec(text.slice(fm[0].length).trimStart().split('\n')[0] ?? '')?.[1]
    ?.trim();
  if (!title) {
    throw new Error(`${file}: frontmatter 바로 뒤 첫 줄이 "# 제목"이어야 한다`);
  }

  const base = { number, file, title, date: meta.data.date };
  return meta.data.status === 'accepted'
    ? { ...base, status: 'accepted' }
    : { ...base, status: 'superseded', supersededBy: meta.data.superseded_by };
}

/** 번호 중복을 거부하고, superseded_by는 존재하는 accepted 결정만 가리켜야 한다(순환·연쇄를 막는다) */
export function validateAdrs(adrs: readonly Adr[]): void {
  const byNumber = new Map<string, Adr>();
  for (const a of adrs) {
    if (byNumber.has(a.number)) throw new Error(`ADR 번호 중복: ${a.number}`);
    byNumber.set(a.number, a);
  }
  for (const a of adrs) {
    if (a.status !== 'superseded') continue;
    if (byNumber.get(a.supersededBy)?.status !== 'accepted') {
      throw new Error(
        `${a.file}: superseded_by ${a.supersededBy}는 존재하는 accepted 결정이어야 한다`,
      );
    }
  }
}

export function renderIndex(adrs: readonly Adr[], dir: string): string {
  return [...adrs]
    .sort((a, b) => a.number.localeCompare(b.number))
    .map(a => {
      const link = `[${a.number}](${dir}/${a.file}) ${a.title}`;
      return a.status === 'accepted'
        ? `- ${link}`
        : `- ~~${link}~~ → ${a.supersededBy}`;
    })
    .join('\n');
}

/** 시작·끝 표시 사이를 색인으로 바꾼다. 표시가 정확히 한 쌍이 아니면 실패한다 */
export function replaceIndex(doc: string, index: string): string {
  const start = doc.indexOf(INDEX_START);
  const end = doc.indexOf(INDEX_END);
  if (
    start < 0 ||
    end < start ||
    doc.indexOf(INDEX_START, start + 1) >= 0 ||
    doc.indexOf(INDEX_END, end + 1) >= 0
  ) {
    throw new Error(
      `${INDEX_START} … ${INDEX_END} 표시가 정확히 한 쌍 있어야 한다`,
    );
  }
  return `${doc.slice(0, start + INDEX_START.length)}\n\n${index}\n\n${doc.slice(end)}`;
}
