import { describe, expect, it } from 'vitest';
import {
  INDEX_END,
  INDEX_START,
  parseAdr,
  renderIndex,
  replaceIndex,
  validateAdrs,
  type Adr,
} from '#/adr.ts';

const adr = (frontmatter: string, body = '# 제목\n\n본문') =>
  `---\n${frontmatter}\n---\n\n${body}\n`;

describe('parseAdr', () => {
  it('번호는 파일 이름에서, 제목은 첫 # 줄에서 읽는다', () => {
    expect(
      parseAdr(
        '0003-db.md',
        adr('date: 2026-11-08\nstatus: accepted', '# DB는 SQLite'),
      ),
    ).toEqual({
      number: '0003',
      file: '0003-db.md',
      title: 'DB는 SQLite',
      date: '2026-11-08',
      status: 'accepted',
    });
  });

  it('CRLF 줄바꿈과 제목 끝 공백을 정리한다', () => {
    expect(
      parseAdr(
        '0001-a.md',
        '---\r\ndate: 2026-11-08\r\nstatus: accepted\r\n---\r\n\r\n# 제목  \r\n',
      ),
    ).toMatchObject({ title: '제목', date: '2026-11-08' });
  });

  it('superseded는 superseded_by가 있어야 한다', () => {
    expect(
      parseAdr(
        '0001-a.md',
        adr('date: 2026-11-08\nstatus: superseded\nsuperseded_by: 0002'),
      ),
    ).toMatchObject({ status: 'superseded', supersededBy: '0002' });
    expect(() =>
      parseAdr('0001-a.md', adr('date: 2026-11-08\nstatus: superseded')),
    ).toThrow();
  });

  it.each([
    ['파일 이름', '1-a.md', adr('date: 2026-11-08\nstatus: accepted')],
    ['대문자 슬러그', '0001-Abc.md', adr('date: 2026-11-08\nstatus: accepted')],
    ['frontmatter 없음', '0001-a.md', '# 제목\n'],
    ['없는 날짜', '0001-a.md', adr('date: 2026-13-01\nstatus: accepted')],
    ['모르는 상태', '0001-a.md', adr('date: 2026-11-08\nstatus: draft')],
    [
      '모르는 키',
      '0001-a.md',
      adr('date: 2026-11-08\nstatus: accepted\ntitle: x'),
    ],
    [
      '제목 없음',
      '0001-a.md',
      adr('date: 2026-11-08\nstatus: accepted', '본문'),
    ],
  ])('형식이 틀리면 실패한다 — %s', (_, file, text) => {
    expect(() => parseAdr(file, text)).toThrow();
  });
});

const accepted = (number: string): Adr => ({
  number,
  file: `${number}-x.md`,
  title: `결정 ${number}`,
  date: '2026-11-08',
  status: 'accepted',
});

describe('validateAdrs', () => {
  it('번호 중복, 없는 번호·자기 자신·대체된 결정을 가리키는 superseded_by를 거부한다', () => {
    expect(() => validateAdrs([accepted('0001'), accepted('0001')])).toThrow();
    expect(() =>
      validateAdrs([
        { ...accepted('0001'), status: 'superseded', supersededBy: '0002' },
        { ...accepted('0002'), status: 'superseded', supersededBy: '0001' },
      ]),
    ).toThrow();
    for (const supersededBy of ['0009', '0001']) {
      expect(() =>
        validateAdrs([
          { ...accepted('0001'), status: 'superseded', supersededBy },
        ]),
      ).toThrow();
    }
    expect(() =>
      validateAdrs([
        { ...accepted('0001'), status: 'superseded', supersededBy: '0002' },
        accepted('0002'),
      ]),
    ).not.toThrow();
  });
});

describe('renderIndex', () => {
  it('번호순, 대체된 결정은 취소선과 대체한 번호', () => {
    expect(
      renderIndex(
        [
          accepted('0002'),
          { ...accepted('0001'), status: 'superseded', supersededBy: '0002' },
        ],
        'docs/adr',
      ),
    ).toBe(
      '- ~~[0001](docs/adr/0001-x.md) 결정 0001~~ → 0002\n- [0002](docs/adr/0002-x.md) 결정 0002',
    );
  });
});

describe('replaceIndex', () => {
  it('표시 사이만 바꾸고 나머지는 그대로', () => {
    const doc = `앞\n${INDEX_START}\n옛 색인\n${INDEX_END}\n뒤\n`;
    expect(replaceIndex(doc, '- 새')).toBe(
      `앞\n${INDEX_START}\n\n- 새\n\n${INDEX_END}\n뒤\n`,
    );
  });

  it('표시가 없거나, 순서가 뒤집혔거나, 두 쌍이면 실패한다', () => {
    for (const doc of [
      '표시 없음',
      `${INDEX_END}${INDEX_START}`,
      `${INDEX_START}${INDEX_END}${INDEX_START}${INDEX_END}`,
    ]) {
      expect(() => replaceIndex(doc, '- 새')).toThrow();
    }
  });
});
