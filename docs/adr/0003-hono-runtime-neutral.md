---
date: 2026-11-09
status: accepted
---

# HTTP는 Hono, 실행 환경은 조립 지점에서만 고른다

## 결정

- HTTP 프레임워크는 Hono다. `interface/http`는 Web 표준 Request/Response만 다루고, 어디서 도는지는 `main`이 정한다.
- 템플릿의 기본 실행은 `@hono/node-server`(`main/server.ts`)다. 다른 런타임(서버리스·엣지 등)으로 옮길 때는 `main`에
  진입점을 하나 더 두면 된다 — 나머지 레이어는 바뀌지 않는다.
- 개발 서버는 Node의 타입 제거(type stripping)로 `.ts`를 바로 실행한다. 그래서 지울 수 없는 TS 문법(enum·매개변수
  프로퍼티 등)은 `erasableSyntaxOnly`로 막는다.

## 이유

호스팅을 정하기 전에도 구조를 쓸 수 있어야 한다. 런타임을 아는 코드가 한 곳에 모여 있으면 옮기는 비용이 진입점 하나로 줄어든다.
