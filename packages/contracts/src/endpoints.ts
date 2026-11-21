import { z } from 'zod';
import {
  HealthSchema,
  TaskDtoSchema,
  TaskListDtoSchema,
  TaskStatusSchema,
} from '#/schemas.ts';

const NoParams = z.object({});

// 엔드포인트 이름. DEFINITIONS가 이 이름을 빠짐없이, 더하지도 않고 갖는지는 satisfies가 본다 — 키 목록을 Object.keys에서
// 얻으면 string[]이라, EndpointName[]으로 다시 좁히는 데 컴파일러가 확인하지 않는 타입 서술이 필요하다
export const ENDPOINT_NAMES = ['health', 'listTasks', 'getTask'] as const;
export type EndpointName = (typeof ENDPOINT_NAMES)[number];

// API 계약의 단일 출처. 서버는 여기 있는 모든 엔드포인트를 구현해야 컴파일되고, 클라이언트는 여기서 호출을 만든다.
// 경로 규칙(계약 테스트가 강제): 버전 접두 /v1, 자원은 kebab-case 복수, 파생 자원은 원본 아래. 인프라용 /health만 예외.
// 파라미터: 경로에 :이름으로 있는 것은 경로로, 나머지는 쿼리 문자열로 간다(값이 없는 키는 보내지 않는다).
const DEFINITIONS = {
  health: {
    method: 'GET',
    path: '/health',
    params: NoParams,
    response: HealthSchema,
  },
  listTasks: {
    method: 'GET',
    path: '/v1/tasks',
    params: z.object({ status: TaskStatusSchema.optional() }),
    response: TaskListDtoSchema,
  },
  getTask: {
    method: 'GET',
    path: '/v1/tasks/:id',
    params: z.object({ id: z.string().min(1) }),
    response: TaskDtoSchema,
  },
} as const satisfies Record<EndpointName, unknown>;

type Definitions = typeof DEFINITIONS;
export type EndpointParams<N extends EndpointName> = z.infer<
  Definitions[N]['params']
>;
export type EndpointResponse<N extends EndpointName> = z.infer<
  Definitions[N]['response']
>;

export interface Endpoint<Params, Response> {
  method: 'GET';
  /** Hono 경로 문법(`:name`). 서버 라우트와 클라이언트 URL이 이 한 줄에서 나온다 */
  path: string;
  params: z.ZodType<Params> & { shape: Record<string, z.ZodType> };
  response: z.ZodType<Response>;
}

// 엔드포인트 이름으로 인덱싱한 mapped type이라, 제네릭 N으로 꺼내도 그 엔드포인트의 타입이 유지된다
// (TS의 correlated union 해법, microsoft/TypeScript#47109). 대입이 곧 DEFINITIONS의 모양 검사다.
export const ENDPOINTS: {
  [N in EndpointName]: Endpoint<EndpointParams<N>, EndpointResponse<N>>;
} = DEFINITIONS;

/** 파라미터 값의 타입. 계약의 params 스키마는 이 범위 안에서만 정의한다 */
type PathParams = Readonly<Record<string, string | number | undefined>>;

/**
 * `getTask` + `{ id: 't1' }` → `/v1/tasks/t1`. 경로에 없는 파라미터는 쿼리로
 * (`listTasks` + `{ status: 'done' }` → `/v1/tasks?status=done`)
 */
export function buildEndpointPath<N extends EndpointName>(
  name: N,
  params: EndpointParams<N>,
): string {
  const values: PathParams = params;
  const inPath = new Set<string>();
  const path = ENDPOINTS[name].path.replace(/:(\w+)/g, (_, key: string) => {
    const value = values[key];
    // 타입과 계약 테스트(경로 파라미터 ⊆ params 키)로 막히지만, 런타임에도 조용히 'undefined'를 넣지 않는다
    if (value === undefined) throw new Error(`경로 파라미터 누락: ${key}`);
    inPath.add(key);
    return encodeURIComponent(String(value));
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (!inPath.has(key) && value !== undefined) query.set(key, String(value));
  }
  const qs = query.toString();
  return qs === '' ? path : `${path}?${qs}`;
}
