import {
  ApiErrorBodySchema,
  buildEndpointPath,
  ENDPOINTS,
  type ApiErrorCode,
  type EndpointName,
  type EndpointParams,
  type EndpointResponse,
} from '@app/contracts';
import { createHttpClient, HttpDecodeError, HttpError } from '@app/http-client';

/** 우리 API의 에러. 계약 밖 응답(프록시 오류 등)은 code가 'unexpected_response'다 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'unexpected_response';

  constructor(
    status: number,
    code: ApiErrorCode | 'unexpected_response',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiClientOptions {
  /** 예: web은 ""(같은 오리진), 다른 오리진의 클라이언트는 "https://<도메인>" */
  baseUrl: string;
  fetch?: typeof fetch;
}

// 파라미터가 없거나 모두 선택인 엔드포인트는 두 번째 인자를 생략할 수 있다
type CallArgs<N extends EndpointName> =
  Record<string, never> extends EndpointParams<N>
    ? [params?: EndpointParams<N>]
    : [params: EndpointParams<N>];

/** 엔드포인트 계약(ENDPOINTS) 하나로 경로 조립·파라미터 검증·응답 검증을 모두 한다 */
export function createApiClient({ baseUrl, fetch }: ApiClientOptions) {
  const http = createHttpClient({
    baseUrl: `${baseUrl.replace(/\/+$/, '')}/api`,
    ...(fetch && { fetch }),
  });

  async function call<N extends EndpointName>(
    name: N,
    ...args: CallArgs<N>
  ): Promise<EndpointResponse<N>> {
    const endpoint = ENDPOINTS[name];
    const params = endpoint.params.parse(args[0] ?? {});
    try {
      return await http.get(buildEndpointPath(name, params), raw =>
        endpoint.response.parse(raw),
      );
    } catch (err) {
      if (err instanceof HttpDecodeError) {
        throw new ApiError(err.status, 'unexpected_response', err.message);
      }
      if (!(err instanceof HttpError)) throw err;
      const body = ApiErrorBodySchema.safeParse(err.body);
      throw body.success
        ? new ApiError(
            err.status,
            body.data.error.code,
            body.data.error.message,
          )
        : new ApiError(err.status, 'unexpected_response', err.message);
    }
  }

  return { call };
}

export type ApiClient = ReturnType<typeof createApiClient>;
