---
date: 2026-11-09
status: accepted
---

# 도구 버전 제약과 공급망 보수

## 결정

<!-- module:renovate:start -->

- 생태계가 아직 못 따라온 새 버전(예: typescript-eslint가 지원하지 않는 TypeScript)은 업그레이드 관문으로 막는다(0009).

<!-- module:renovate:end -->

- 버전은 `pnpm-workspace.yaml`의 catalog 한 곳에만 적고, 함께 움직여야 하는 묶음만 named catalog로 둔다.
- 설치 스크립트는 기본 거부(`allowBuilds`)하고 필요한 것만 연다.
- 갓 나온 릴리스는 바로 쓰지 않는다. pnpm의 `minimumReleaseAgeExclude`가 생기면 지우고 버전을 낮춘다.
- 패키지 내부 import는 `#/파일.ts`(package.json `imports`)로, 확장자를 명시한다. 상대 경로는 lint가 막는다.
