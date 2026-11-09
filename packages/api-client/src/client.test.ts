import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from '#/client.ts';

const respond =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

const recording = () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true }));
  };
  return { urls, fetchImpl };
};

describe('createApiClient', () => {
  it('계약의 경로로 호출한다 — baseUrl 끝 슬래시 정리, /api 접두, 경로 파라미터 인코딩', async () => {
    const { urls, fetchImpl } = recording();
    const api = createApiClient({
      baseUrl: 'https://example.com/',
      fetch: fetchImpl,
    });
    await api.call('health');
    await api.call('getTask', { id: 'a b' }).catch(() => {});
    expect(urls).toEqual([
      'https://example.com/api/health',
      'https://example.com/api/v1/tasks/a%20b',
    ]);
  });

  it('모두 선택인 파라미터는 생략할 수도, 쿼리로 보낼 수도 있다', async () => {
    const { urls, fetchImpl } = recording();
    const api = createApiClient({ baseUrl: '', fetch: fetchImpl });
    await api.call('listTasks').catch(() => {});
    await api.call('listTasks', { status: 'done' }).catch(() => {});
    expect(urls).toEqual(['/api/v1/tasks', '/api/v1/tasks?status=done']);
  });

  it('계약에 맞지 않는 파라미터는 요청을 보내기 전에 거부한다', async () => {
    const { urls, fetchImpl } = recording();
    const api = createApiClient({ baseUrl: '', fetch: fetchImpl });
    await expect(api.call('getTask', { id: '' })).rejects.toThrow();
    expect(urls).toEqual([]);
  });

  it('계약의 에러 본문은 코드가 좁혀진 ApiError로', async () => {
    const api = createApiClient({
      baseUrl: '',
      fetch: respond(404, {
        error: { code: 'task_not_found', message: '없음' },
      }),
    });
    const err = await api
      .call('getTask', { id: 't1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'task_not_found' });
  });

  it('계약 밖 에러 응답(프록시 오류 등)은 unexpected_response', async () => {
    const api = createApiClient({
      baseUrl: '',
      fetch: async () => new Response('Bad Gateway', { status: 502 }),
    });
    await expect(api.call('health')).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_response',
    });
  });

  it('계약과 다른 성공 응답·JSON이 아닌 성공 응답(SPA HTML 등)도 unexpected_response', async () => {
    const fetches: (typeof fetch)[] = [
      respond(200, { ok: 'yes' }),
      async () => new Response('<!doctype html>', { status: 200 }),
    ];
    for (const fetchImpl of fetches) {
      const api = createApiClient({ baseUrl: '', fetch: fetchImpl });
      const err = await api.call('health').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 200, code: 'unexpected_response' });
    }
  });
});
