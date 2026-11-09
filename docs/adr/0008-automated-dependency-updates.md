---
date: 2026-11-09
status: accepted
---

# 의존성은 Renovate가 늘 최신으로 따라간다

## 결정

- 매일 아침(Asia/Seoul) Renovate가 업데이트 PR을 연다. 릴리스 뒤 14일이 지난 버전만 올린다(보안 수정은 즉시).
- **major까지 모두 자동 머지**한다. 머지 여부는 브랜치 보호의 필수 체크(lint·타입·테스트·가드 테스트)가 정한다 —
  깨지면 PR이 열린 채로 남는다.
- major에는 `deps-major` 라벨을 붙여 Claude 코드 리뷰가 breaking change를 이 저장소 코드와 대조한 코멘트를 남긴다.
- 예외: `anthropics/claude-code-action`은 저장소 토큰을 쥐는 액션이라 사람이 diff를 보고 머지한다.
- 함께 움직이는 묶음(lint 툴체인 등)은 한 PR로 묶는다. GitHub Actions는 SHA로 고정한다.
- 업데이트 알림 메일은 받지 않는다 — 저장소 알림을 끄고(watch: ignore), 깨진 업데이트는 Dependency Dashboard 이슈에서 본다.

## 이유

업데이트를 미루면 한 번에 여러 major를 넘어야 한다. 자동 머지의 안전망은 테스트와 lint 가드다 — 그래서 규칙이
"실제로 막는지"를 테스트로 증명해 두는 것(0001)이 자동 업데이트의 전제다.
