# ts-monorepo-template

AI 에이전트가 작업해도 구조가 무너지지 않는 TypeScript 모노레포 템플릿.

지켜야 할 규칙을 문서에 적어 두는 대신 **lint·타입·테스트·git hook이 막게** 해 두었다. 사람이든 에이전트든 규칙을
잊어도 실행 경로가 막고, 규칙을 주석 한 줄로 끄거나 설정에서 지우면 그것도 테스트가 잡는다.

<!-- module:template:start -->

## 시작하기

1. GitHub에서 **Use this template → Create a new repository**, 또는

   ```sh
   gh repo create my-app --private --template <owner>/ts-monorepo-template --clone
   cd my-app
   ```

2. 초기화 — 필요 없는 모듈을 빼고, 이름을 바꾸고, 다시 설치한다

   ```sh
   pnpm install
   pnpm init:project my-app                      # 모듈마다 넣을지 묻는다
   pnpm init:project my-app --without=db,claude  # 묻지 않고 바로
   ```

   | 모듈       | 빼면 지워지는 것                                                                  |
   | ---------- | --------------------------------------------------------------------------------- |
   | `api`      | `apps/api`, `contracts`·`api-client`·`http-client`, 관련 ADR (`db`도 함께 빠진다) |
   | `db`       | `apps/api`의 SqlClient·마이그레이션·SQL 저장소, PGlite 테스트, 관련 ADR           |
   | `claude`   | Claude 워크플로(PR 코드 리뷰·`@claude` 멘션), `.claude/`                          |
   | `renovate` | `renovate.json`, 관련 ADR                                                         |

   도메인·lint 규칙과 가드 테스트·tsconfig·ADR 색인·lefthook·CI는 늘 남는다. 어떤 조합으로 시작해도 처음부터 검사가
   통과하는지는 이 템플릿의 CI(`template-init.yml`)가 조합마다 init을 돌려 확인한다. 초기화가 끝나면 이 절과 init
   스크립트는 지워진다.

3. 저장소 설정 — 템플릿으로 복사되지 않으니 새 저장소마다 한 번
   - **브랜치 보호**: `main`에 `Lint / Types / Tests` 체크를 필수로 건다.
   - **자동 머지 켜기**(Renovate가 GitHub 자동 머지를 쓴다):
     `gh repo edit --enable-auto-merge --enable-squash-merge --delete-branch-on-merge`
   - **업데이트 메일 끄기**(선택): `gh api -X PUT repos/<owner>/<repo>/subscription -F ignored=true`
   - [Renovate 앱](https://github.com/apps/renovate)을 이 저장소에 설치한다.
   - `README.md`를 프로젝트 소개로, `AGENTS.md`의 "목적"을 채운다.

<!-- module:template:end -->

## 무엇이 막히나

- 의존은 바깥 → 안쪽으로만(도메인은 프레임워크·I/O를 모른다) — eslint-plugin-boundaries, 허용 목록만
- 규칙을 주석으로 끄지 못한다 — `noInlineConfig` + `eslint-comments/no-use`
- lint 설정이 실제로 막는지 — `packages/eslint-config/guards.test.mts`가 위반을 넣어 확인한다(양성 대조 포함)
- 상대 경로 import 금지(`#/` 별칭·패키지 이름만) — `no-restricted-imports`
- 엄격 타입(`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes` 등) — `packages/tsconfig/base.json`
- 결정 기록(ADR) 색인이 AGENTS.md와 맞는다 — 테스트 + 커밋 hook
- 커밋 전 포매팅, 푸시 전 전체 검사 — lefthook

<!-- module:api:start -->

- API 계약의 모든 엔드포인트에 서버 구현이 있다 — 타입(`Handlers` mapped type)

<!-- module:api:end -->

## 구조

- `packages/domain` — 엔티티·순수 규칙(zod만 의존). 서버와 클라이언트가 같이 쓴다
- `packages/eslint-config` — 공통 lint 규칙 + `layers()` 경계 헬퍼 + 가드 테스트
- `packages/tsconfig` — 공통 tsconfig 프리셋
- `packages/docs-index` — `docs/adr` → AGENTS.md 결정 색인 생성·검사
- `docs/adr` — 설계 결정 기록

<!-- module:api:start -->

- `apps/api` — Hono 서버: application(유스케이스·포트) / infrastructure(어댑터) / interface(HTTP) / main(조립)
- `packages/contracts` — API 계약(경로·파라미터·응답 스키마), 서버와 클라이언트의 단일 출처
- `packages/api-client` — 계약으로 만든 타입 안전 클라이언트
- `packages/http-client` — fetch 래퍼(zod 검증·인터셉터·가드)

예시 도메인은 "할 일(task)" 하나로, 도메인 → 계약 → 유스케이스 → 저장소 → HTTP까지 모든 계층을 관통한다. 내 도메인으로
바꿀 때 이 흐름을 그대로 따라가면 된다.

<!-- module:api:end -->

UI 프레임워크와 스타일은 넣지 않았다 — 프로젝트마다 다시 고르는 부분이고, 들어 있으면 걷어내는 비용이 크다. 웹이든 CLI든
`apps/<이름>`을 만들고, 그 앱의 `eslint.config.mts`에서 `layers()`로 경계를 적는다.

## 명령

필요한 도구: `.tool-versions`의 Node·pnpm(mise·asdf 등).

- `pnpm turbo run lint check-types test` — 전체 검사(push 전 hook과 CI가 같은 것을 돈다)
- `pnpm docs:index` — ADR 색인을 AGENTS.md에 다시 쓴다
- `pnpm format` — prettier

<!-- module:api:start -->

- `pnpm dev` — API(Node 타입 제거 실행, watch) http://localhost:8787/api/v1/tasks

<!-- module:api:end -->

## 함께 오는 것

- **CI**(`.github/workflows/ci.yml`): lint·타입·테스트·포맷.
- **에이전트 지침**: `AGENTS.md`(+ `CLAUDE.md` 링크).

<!-- module:claude:start -->

- **Claude 워크플로**: PR 코드 리뷰(`claude-code-review.yml`)와 `@claude` 멘션 응답(`claude.yml`), 스킬(`.claude/skills/`,
  외부 스킬은 각 폴더의 `SOURCE.md`에 출처). 저장소 secret `CLAUDE_CODE_OAUTH_TOKEN`(`claude setup-token`으로 발급)이
  있어야 돈다 — 없으면 PR마다 리뷰 체크가 실패한다.

<!-- module:claude:end -->
<!-- module:renovate:start -->

- **Renovate**(`renovate.json`): 매일 아침 최신 버전으로 올린다. 릴리스 뒤 14일이 지난 버전만, 브랜치 보호의 필수
  체크가 초록이면 major까지 자동 머지한다. [Renovate 앱](https://github.com/apps/renovate)을 저장소에 설치하고
  자동 머지를 켜야 돈다(아래 저장소 설정).

<!-- module:renovate:end -->

## 결정 기록

왜 이렇게 되어 있는지는 [`docs/adr/`](docs/adr)에 있다.
