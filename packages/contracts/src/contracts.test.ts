import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  ApiErrorBodySchema,
} from '#/errors.ts';
import { buildEndpointPath, ENDPOINT_NAMES, ENDPOINTS } from '#/endpoints.ts';

describe('에러 계약', () => {
  it('모든 에러 코드에 HTTP 상태가 있다', () => {
    expect(Object.keys(API_ERROR_STATUS).sort()).toEqual(
      [...API_ERROR_CODES].sort(),
    );
  });

  it('목록에 없는 에러 코드는 계약 위반이다', () => {
    expect(
      ApiErrorBodySchema.safeParse({ error: { code: 'teapot', message: '' } })
        .success,
    ).toBe(false);
  });
});

describe('엔드포인트 계약', () => {
  it('ENDPOINT_NAMES는 ENDPOINTS의 키 전부다', () => {
    expect([...ENDPOINT_NAMES].sort()).toEqual(Object.keys(ENDPOINTS).sort());
  });

  it('경로 파라미터는 모두 params 스키마에 정의돼 있다(나머지 params 키는 쿼리)', () => {
    for (const name of ENDPOINT_NAMES) {
      const { path, params } = ENDPOINTS[name];
      const keys = Object.keys(params.shape);
      for (const m of path.matchAll(/:(\w+)/g)) {
        expect(keys, name).toContain(m[1]);
      }
    }
  });

  it('경로 규칙: 인프라(/health) 외에는 /v1 접두, 세그먼트는 kebab-case 또는 :param', () => {
    for (const name of ENDPOINT_NAMES) {
      const { path } = ENDPOINTS[name];
      if (path === '/health') continue;
      expect(path, name).toMatch(
        /^\/v1(\/([a-z0-9]+(-[a-z0-9]+)*|:[a-zA-Z]+))+$/,
      );
    }
  });

  it('buildEndpointPath는 계약의 경로에 값을 인코딩해 채운다', () => {
    expect(buildEndpointPath('getTask', { id: 'a/b' })).toBe('/v1/tasks/a%2Fb');
    expect(buildEndpointPath('health', {})).toBe('/health');
  });

  it('경로에 없는 파라미터는 쿼리 문자열로, 값이 없는 키는 뺀다', () => {
    expect(buildEndpointPath('listTasks', {})).toBe('/v1/tasks');
    expect(buildEndpointPath('listTasks', { status: 'done' })).toBe(
      '/v1/tasks?status=done',
    );
  });

  it('상태 필터는 도메인의 상태 값만 받는다', () => {
    expect(
      ENDPOINTS.listTasks.params.safeParse({ status: 'archived' }).success,
    ).toBe(false);
  });
});
