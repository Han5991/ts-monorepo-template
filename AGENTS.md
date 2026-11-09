# AGENTS.md

이 파일이 **유일한** 에이전트 지침 파일이고, 루트 `CLAUDE.md`는 이 파일을 가리키는 심볼릭 링크다(지우지 않는다).
여기에는 **코드·설정에서 읽을 수 없는 것**(결정과 이유, 외부 사실, 주의점)만 둔다. 구조·명령·버전·구현 현황은
코드가 출처다. 함수 동작과 비즈니스 규칙은 주석이 아니라 테스트(이름 + 단언)로 남긴다.

## 목적

<!-- 이 프로젝트가 무엇을 위한 것인지 한두 문장. 템플릿에서 만든 직후에 채운다. -->

## 원칙

- **규칙은 실행 경로에 둔다.** 지켜야 할 규칙은 lint·타입·테스트·hook으로 막고, 막을 수 없는 것만 여기 적는다.
- **우회하지 않는다.** lint·타입 오류를 단언(`as`)·인라인 주석·설정 예외로 덮지 않는다. 예외가 꼭 필요하면 설정 파일에
  좁은 범위와 이유를 적고 PR에서 드러낸다.
- **출처 없는 외부 사실 금지.** 버전 지원·한도 같은 외부 사실에는 출처 URL과 확인 날짜를 붙인다.

## 설계 결정

결정과 이유는 `docs/adr/`에 한 결정에 한 파일로 있다(형식·추가 방법은 `docs/adr/README.md`). 작업 전에 관련 결정을 읽고,
새로 정한 것은 ADR로 남긴다. 아래 색인은 `pnpm docs:index`가 생성한다 — 손으로 고치지 않는다.

<!-- adr-index:start -->

- [0001](docs/adr/0001-layers-enforced-by-lint.md) 계층 구조(DDD + 클린 아키텍처)를 문서가 아니라 lint로 강제한다
- [0002](docs/adr/0002-contract-first-api.md) API는 계약 우선, 경로는 /api/v1
- [0003](docs/adr/0003-hono-runtime-neutral.md) HTTP는 Hono, 실행 환경은 조립 지점에서만 고른다
- [0004](docs/adr/0004-portable-sql.md) DB는 SqlClient 포트 뒤에, SQL은 SQLite·Postgres 공통 부분만
- [0005](docs/adr/0005-shared-domain-engine.md) 클라이언트는 여럿, 규칙과 계산은 공유 도메인에만
- [0006](docs/adr/0006-toolchain-and-supply-chain.md) 도구 버전 제약과 공급망 보수
- [0007](docs/adr/0007-rules-only-in-config.md) 규칙은 설정 파일에서만 바꾼다: 인라인 eslint 주석 금지
- [0008](docs/adr/0008-automated-dependency-updates.md) 의존성은 Renovate가 늘 최신으로 따라간다
- [0009](docs/adr/0009-upgrade-gates.md) 생태계가 못 따라온 새 버전은 관문으로 막고, 따라오면 자동으로 푼다

<!-- adr-index:end -->

## 외부 설정

- `main` 브랜치 보호에 `Lint / Types / Tests` 체크가 필수로 걸려 있어야 한다(저장소 설정 — 코드로 복사되지 않는다).

<!-- module:claude:start -->

- Claude 워크플로(`.github/workflows/claude*.yml`)는 저장소 secret `CLAUDE_CODE_OAUTH_TOKEN`이 있어야 돈다
  (`claude setup-token`이 만드는 토큰, 유효 기간이 있다). 발급일: (YYYY-MM-DD)

<!-- module:claude:end -->
<!-- module:renovate:start -->

- Renovate는 GitHub App(https://github.com/apps/renovate)을 이 저장소에 설치해야 돈다.

<!-- module:renovate:end -->
