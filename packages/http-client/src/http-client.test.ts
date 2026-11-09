import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createHttpClient,
  HttpDecodeError,
  HttpError,
  throttle,
  withHeaders,
} from '#/http-client.ts';

const OkSchema = z.object({ ok: z.literal(true) });
const Ok = (raw: unknown) => OkSchema.parse(raw);

const recording = (status: number, body: string) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(body, { status });
  };
  return { calls, fetchImpl };
};

describe('createHttpClient', () => {
  it('baseUrl 끝 슬래시를 정리하고 기본 헤더와 사용자 헤더를 함께 보낸다', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({
      baseUrl: 'https://example.com/',
      fetch: fetchImpl,
      headers: { authorization: 'Bearer t' },
    });
    expect(await http.get('/x?a=1', Ok)).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://example.com/x?a=1');
    expect(calls[0]?.init?.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer t',
    });
  });

  it('decode는 응답 상태·헤더도 받는다(연속 조회 표시 등)', async () => {
    const http = createHttpClient({
      baseUrl: '',
      fetch: async () =>
        new Response('{"ok":true}', { headers: { tr_cont: 'M' } }),
    });
    expect(
      await http.get('/x', (raw, meta) => [
        Ok(raw),
        meta.status,
        meta.headers.get('tr_cont'),
      ]),
    ).toEqual([{ ok: true }, 200, 'M']);
  });

  it('요청별 헤더는 기본 헤더 위에 덮어쓴다', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      headers: { authorization: 'Bearer old', 'x-a': '1' },
    });
    await http.get('/x', Ok, { headers: { authorization: 'Bearer new' } });
    expect(calls[0]?.init?.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer new',
      'x-a': '1',
    });
  });

  it('postForm은 URL 인코딩한 본문과 form content-type을 보낸다', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({ baseUrl: '', fetch: fetchImpl });
    await http.postForm(
      '/token',
      { grant_type: 'client_credentials', id: 'a b&c' },
      Ok,
    );
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(
      'grant_type=client_credentials&id=a+b%26c',
    );
    expect(calls[0]?.init?.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
    });
  });

  it('POST는 JSON 본문과 content-type을 보낸다', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({ baseUrl: '', fetch: fetchImpl });
    await http.post('/y', { a: 1 }, Ok);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe('{"a":1}');
  });

  it('2xx가 아니면 HttpError — 본문은 JSON이면 파싱, 아니면 텍스트', async () => {
    const json = createHttpClient({
      baseUrl: '',
      fetch: recording(404, '{"error":{"code":"x"}}').fetchImpl,
    });
    await expect(json.get('/z', Ok)).rejects.toMatchObject({
      status: 404,
      body: { error: { code: 'x' } },
    });
    const text = createHttpClient({
      baseUrl: '',
      fetch: recording(502, 'Bad Gateway').fetchImpl,
    });
    await expect(text.get('/z', Ok)).rejects.toBeInstanceOf(HttpError);
    await expect(text.get('/z', Ok)).rejects.toMatchObject({
      body: 'Bad Gateway',
    });
  });

  it('성공 응답이 스키마와 다르거나 JSON이 아니면 HttpDecodeError', async () => {
    for (const body of ['{"ok":"yes"}', '<html>']) {
      const http = createHttpClient({
        baseUrl: '',
        fetch: recording(200, body).fetchImpl,
      });
      const err = await http.get('/z', Ok).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpDecodeError);
      expect(err).toMatchObject({ status: 200 });
    }
  });

  it('요청 인터셉터가 throw하면 요청을 보내지 않는다(가드 용도)', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      interceptors: {
        request: [
          r => {
            if (r.path.startsWith('/blocked'))
              throw new Error(`차단: ${r.method} ${r.path}`);
            return r;
          },
        ],
      },
    });
    await expect(http.post('/blocked', {}, Ok)).rejects.toThrow(/차단/);
    expect(calls).toEqual([]);
  });

  it('요청 인터셉터는 등록 순서대로 헤더를 더하고, 앞선 인터셉터가 본 헤더를 뒤에서 볼 수 있다', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const seen: string[] = [];
    const http = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      interceptors: {
        request: [
          withHeaders({ authorization: 'Bearer t' }),
          r => {
            seen.push(r.headers.authorization ?? '');
            return r;
          },
        ],
      },
    });
    await http.get('/x', Ok);
    expect(seen).toEqual(['Bearer t']);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer t',
    });
  });

  it('요청 인터셉터는 method·path를 바꿀 수 없다 — 앞선 검사를 우회하지 못하게', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      interceptors: { request: [r => ({ ...r, path: '/elsewhere' })] },
    });
    await expect(http.get('/x', Ok)).rejects.toThrow(/바꿀 수 없다/);
    expect(calls).toEqual([]);
  });

  it('응답 인터셉터는 상태 판정 전에 실행되어 응답을 바꿀 수 있다', async () => {
    const { fetchImpl } = recording(503, 'down');
    const log: string[] = [];
    const http = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      interceptors: {
        response: [
          (res, req) => {
            log.push(`${req.method} ${req.path} ${res.status}`);
            return new Response('{"ok":true}');
          },
        ],
      },
    });
    expect(await http.get('/x', Ok)).toEqual({ ok: true });
    expect(log).toEqual(['GET /x 503']);
  });

  it('extend는 원래 인터셉터 뒤에 새 인터셉터를 붙인 새 클라이언트를 만들고, 원래 것은 그대로다', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const order: string[] = [];
    const base = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      interceptors: { request: [r => (order.push('base'), r)] },
    });
    const authed = base.extend({
      request: [
        withHeaders({ authorization: 'Bearer t' }),
        r => (order.push('more'), r),
      ],
    });
    await authed.get('/a', Ok);
    await base.get('/b', Ok);
    expect(order).toEqual(['base', 'more', 'base']);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer t',
    });
    expect(calls[1]?.init?.headers).not.toHaveProperty('authorization');
  });

  it('throttle은 요청 사이를 최소 간격만큼 벌린다(동시에 몰려도 줄을 선다)', async () => {
    let now = 1000;
    const slept: number[] = [];
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    };
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const http = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      interceptors: { request: [throttle(500, clock)] },
    });
    await Promise.all([
      http.get('/a', Ok),
      http.get('/b', Ok),
      http.get('/c', Ok),
    ]);
    expect(slept).toEqual([500, 1000]);
    now = 5000;
    await http.get('/d', Ok);
    expect(slept).toEqual([500, 1000]);
    expect(calls).toHaveLength(4);
  });

  it('가드는 extend로 붙인 인터셉터까지 끝난 최종 요청을 본다 — 뒤에서 헤더를 바꿔 우회하지 못하게', async () => {
    const { calls, fetchImpl } = recording(200, '{"ok":true}');
    const base = createHttpClient({
      baseUrl: '',
      fetch: fetchImpl,
      guards: [
        r => {
          if (r.headers.tr_id?.endsWith('U')) throw new Error('쓰기 차단');
        },
      ],
    });
    const sneaky = base.extend({
      request: [withHeaders({ tr_id: 'TTTC0012U' })],
    });
    await expect(sneaky.get('/x', Ok)).rejects.toThrow('쓰기 차단');
    expect(calls).toEqual([]);
    await base.get('/x', Ok, { headers: { tr_id: 'TTTC8434R' } });
    expect(calls).toHaveLength(1);
  });

  it('리다이렉트를 따라가지 않는다(가드가 본 경로로만 간다) — 3xx는 HttpError', async () => {
    const { calls, fetchImpl } = recording(307, '');
    const http = createHttpClient({ baseUrl: '', fetch: fetchImpl });
    await expect(http.get('/x', Ok)).rejects.toMatchObject({ status: 307 });
    expect(calls[0]?.init?.redirect).toBe('manual');
  });
});
