import { Hono, type Context } from 'hono';
import {
  API_ERROR_STATUS,
  ENDPOINT_NAMES,
  ENDPOINTS,
  type ApiErrorBody,
  type ApiErrorCode,
  type EndpointName,
  type EndpointParams,
  type EndpointResponse,
  type TaskDto,
} from '@app/contracts';
import type { Task } from '@app/domain';
import type { TaskQueries } from '#/application/use-cases/task-queries.ts';

export interface HttpDeps {
  tasks: TaskQueries;
}

/** 핸들러가 계약에 정의된 에러로 응답할 때 돌려준다 */
export class ApiProblem {
  readonly code: ApiErrorCode;
  readonly message: string;

  constructor(code: ApiErrorCode, message: string) {
    this.code = code;
    this.message = message;
  }
}

type Handler<N extends EndpointName> = (
  params: EndpointParams<N>,
  deps: HttpDeps,
) => Promise<EndpointResponse<N> | ApiProblem>;

// 계약의 모든 엔드포인트에 핸들러가 있어야 컴파일된다
type Handlers = { [N in EndpointName]: Handler<N> };

// 도메인 → 계약(DTO). 지금은 모양이 같지만 API를 바꿔도 도메인이 흔들리지 않게 경계에서 옮겨 담는다
const toTaskDto = ({ id, title, status }: Task): TaskDto => ({
  id,
  title,
  status,
});

const handlers: Handlers = {
  health: async () => ({ ok: true }),
  listTasks: async ({ status }, { tasks }) => ({
    tasks: (await tasks.list(status)).map(toTaskDto),
  }),
  getTask: async ({ id }, { tasks }) => {
    const task = await tasks.get(id);
    return task
      ? toTaskDto(task)
      : new ApiProblem('task_not_found', `할 일 없음: ${id}`);
  },
};

export function createHttpApp(deps: HttpDeps) {
  const api = new Hono();
  for (const name of ENDPOINT_NAMES) register(api, name, handlers, deps);
  api.notFound(c => errorJson(c, 'not_found', `경로 없음: ${c.req.path}`));

  const app = new Hono();
  app.route('/api', api);
  app.notFound(c =>
    c.req.path.startsWith('/api')
      ? errorJson(c, 'not_found', `경로 없음: ${c.req.path}`)
      : c.text('Not Found', 404),
  );
  app.onError((err, c) => {
    console.error(err);
    return c.req.path.startsWith('/api')
      ? errorJson(c, 'internal', '서버 오류')
      : c.text('서버 오류', 500);
  });
  return app;
}

function register<N extends EndpointName>(
  app: Hono,
  name: N,
  all: Handlers,
  deps: HttpDeps,
) {
  const endpoint = ENDPOINTS[name];
  const handler: Handler<N> = all[name];

  app.on(endpoint.method, endpoint.path, async c => {
    // 경로에 없는 계약 파라미터는 쿼리로 온다(contracts buildEndpointPath). 경로 값이 이긴다
    const parsed = endpoint.params.safeParse({
      ...c.req.query(),
      ...c.req.param(),
    });
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      return errorJson(c, 'invalid_params', detail);
    }
    const result = await handler(parsed.data, deps);
    return result instanceof ApiProblem
      ? errorJson(c, result.code, result.message)
      : c.json(result);
  });
}

function errorJson(c: Context, code: ApiErrorCode, message: string) {
  return c.json(
    { error: { code, message } } satisfies ApiErrorBody,
    API_ERROR_STATUS[code],
  );
}
