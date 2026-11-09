---
date: 2026-11-09
status: accepted
---

# 의존성은 Renovate가 늘 최신으로 따라간다

## 결정

- 매주 월요일 아침(Asia/Seoul) Renovate가 업데이트 PR을 연다. 릴리스 뒤 14일이 지난 버전만 올린다(보안 수정은 즉시).
- minor·patch·digest와 lockfile 유지보수는 CI(lint·타입·테스트·가드 테스트)가 초록이면 자동 머지한다.
- major는 자동 머지하지 않고 `deps-major` 라벨을 붙인다. Claude 코드 리뷰가 breaking change를 이 저장소 코드와 대조한다.
- 함께 움직이는 묶음(lint 툴체인 등)은 한 PR로 묶는다. GitHub Actions는 SHA로 고정한다.

## 이유

업데이트를 미루면 한 번에 여러 major를 넘어야 한다. 자동 머지의 안전망은 테스트와 lint 가드다 — 그래서 규칙이
"실제로 막는지"를 테스트로 증명해 두는 것(0001)이 자동 업데이트의 전제다.
