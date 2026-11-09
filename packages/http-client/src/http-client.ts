/** 응답 상태와 헤더(연속 조회 표시 등) */
export interface ResponseMeta {
  status: number;
  headers: Headers;
}

/** 응답 본문(JSON)을 검증해 원하는 타입으로 바꾼다. zod면 `raw => Schema.parse(raw)`. 헤더가 필요하면 둘째 인자 */
export type Decode<T> = (raw: unknown, meta: ResponseMeta) => T;

export type HttpMethod = 'GET' | 'POST';

/** 인터셉터가 보는 요청. 본문은 보지 않는다(이미 직렬화된 값이라 바꿀 일이 없다) */
export interface HttpRequest {
  readonly method: HttpMethod;
  /** baseUrl 뒤에 붙는 경로(쿼리 포함) */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * 보내기 전에 등록 순서대로 실행된다. 헤더를 더한 요청을 돌려주거나(토큰 등), throw로 요청을 막는다(쓰기 금지 가드 등).
 * method·path는 바꿀 수 없다 — 앞선 인터셉터의 검사를 뒤에서 우회하지 못하게.
 */
export type RequestInterceptor = (
  request: HttpRequest,
) => HttpRequest | Promise<HttpRequest>;

/** 응답을 받은 뒤, 상태 코드로 판정하기 전에 등록 순서대로 실행된다(로깅·응답 교체 등) */
export type ResponseInterceptor = (
  response: Response,
  request: HttpRequest,
) => Response | Promise<Response>;

/**
 * 모든 인터셉터(extend로 붙인 것 포함)가 끝난 뒤, 실제로 보낼 요청을 마지막으로 검사한다. throw하면 보내지 않는다.
 * 쓰기 금지 가드처럼 "뒤에서 헤더를 바꿔도 우회되면 안 되는" 검사용 — extend로 지우거나 앞지를 수 없다.
 */
export type RequestGuard = (request: HttpRequest) => void;

export interface Interceptors {
  request?: readonly RequestInterceptor[];
  response?: readonly ResponseInterceptor[];
}

export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

/**
 * 요청 사이를 최소 intervalMs만큼 벌리는 요청 인터셉터(초당 호출 제한이 있는 API용). 이 인터셉터를 공유하는 요청끼리
 * 순서대로 줄을 선다 — 같은 클라이언트에서 extend로 만든 클라이언트도 함께 센다.
 */
export function throttle(
  intervalMs: number,
  clock: Clock = realClock,
): RequestInterceptor {
  let next = 0;
  return async request => {
    const now = clock.now();
    const at = Math.max(now, next);
    next = at + intervalMs;
    if (at > now) await clock.sleep(at - now);
    return request;
  };
}

/** 헤더를 더하는 요청 인터셉터. 요청에 이미 있는 같은 이름은 덮어쓴다 */
export const withHeaders =
  (headers: Record<string, string>): RequestInterceptor =>
  request => ({ ...request, headers: { ...request.headers, ...headers } });

/** 2xx가 아닌 응답. body는 JSON이면 파싱한 값, 아니면 원문 텍스트 */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** 2xx인데 본문이 JSON이 아니거나 decode가 거부한 응답(예: 프록시가 200으로 준 HTML) */
export class HttpDecodeError extends Error {
  readonly status: number;

  constructor(status: number, cause: unknown) {
    const reason = cause instanceof Error ? `: ${cause.message}` : '';
    super(`HTTP ${status} 응답을 해석하지 못했다${reason}`, { cause });
    this.name = 'HttpDecodeError';
    this.status = status;
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  interceptors?: Interceptors;
  guards?: readonly RequestGuard[];
}

/** 요청마다 더할 헤더(기본 헤더 위에 덮어쓴다). 예: 토큰을 받은 뒤의 Authorization, 계좌 헤더 */
export interface RequestOptions {
  headers?: Record<string, string>;
}

type Body =
  | { kind: 'none' }
  | { kind: 'json'; value: unknown }
  | { kind: 'form'; value: Record<string, string> };

const CONTENT_TYPE = {
  none: undefined,
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
} as const satisfies Record<Body['kind'], string | undefined>;

function encode(body: Body): string | undefined {
  switch (body.kind) {
    case 'none':
      return undefined;
    case 'json':
      return JSON.stringify(body.value);
    case 'form':
      return new URLSearchParams(body.value).toString();
  }
}

export function createHttpClient(options: HttpClientOptions) {
  const { baseUrl, fetch: fetchImpl = fetch, headers = {} } = options;
  const requestInterceptors = options.interceptors?.request ?? [];
  const responseInterceptors = options.interceptors?.response ?? [];
  const guards = options.guards ?? [];
  const root = baseUrl.replace(/\/+$/, '');

  async function send<T>(
    method: HttpMethod,
    path: string,
    decode: Decode<T>,
    body: Body,
    requestOptions: RequestOptions,
  ): Promise<T> {
    const contentType = CONTENT_TYPE[body.kind];
    let request: HttpRequest = {
      method,
      path,
      headers: {
        accept: 'application/json',
        ...(contentType === undefined ? {} : { 'content-type': contentType }),
        ...headers,
        ...requestOptions.headers,
      },
    };
    for (const intercept of requestInterceptors) {
      const next = await intercept(request);
      if (next.method !== method || next.path !== path) {
        throw new Error('요청 인터셉터는 method·path를 바꿀 수 없다');
      }
      request = next;
    }
    for (const guard of guards) guard(request);
    const encoded = encode(body);
    let res = await fetchImpl(`${root}${path}`, {
      method,
      headers: { ...request.headers },
      // 리다이렉트를 따라가면 가드가 본 경로와 실제로 간 경로가 달라진다 — 3xx는 그대로 실패로 다룬다
      redirect: 'manual',
      ...(encoded === undefined ? {} : { body: encoded }),
    });
    for (const intercept of responseInterceptors) {
      res = await intercept(res, request);
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, parseIfJson(text));
    try {
      return decode(JSON.parse(text), {
        status: res.status,
        headers: res.headers,
      });
    } catch (cause) {
      throw new HttpDecodeError(res.status, cause);
    }
  }

  return {
    /** 같은 설정에 인터셉터를 덧붙인 새 클라이언트(원래 것 뒤에 실행된다). 예: 토큰을 받은 뒤 인증 헤더 */
    extend: (more: Interceptors) =>
      createHttpClient({
        ...options,
        interceptors: {
          request: [...requestInterceptors, ...(more.request ?? [])],
          response: [...responseInterceptors, ...(more.response ?? [])],
        },
      }),
    get: <T>(path: string, decode: Decode<T>, options: RequestOptions = {}) =>
      send('GET', path, decode, { kind: 'none' }, options),
    post: <T>(
      path: string,
      body: unknown,
      decode: Decode<T>,
      options: RequestOptions = {},
    ) => send('POST', path, decode, { kind: 'json', value: body }, options),
    /** application/x-www-form-urlencoded 본문(OAuth2 토큰 요청 등) */
    postForm: <T>(
      path: string,
      form: Record<string, string>,
      decode: Decode<T>,
      options: RequestOptions = {},
    ) => send('POST', path, decode, { kind: 'form', value: form }, options),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;

function parseIfJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
