---
date: 2026-11-09
status: accepted
---

# 규칙은 설정 파일에서만 바꾼다: 인라인 eslint 주석 금지

## 결정

- 공통 설정이 `linterOptions.noInlineConfig: true`로 `eslint-disable` 같은 주석을 무효로 만들고,
  `@eslint-community/eslint-comments/no-use`로 그 주석 자체를 오류로 만든다.
- 예외가 필요하면 그 패키지의 `eslint.config.mts`에 좁은 `files` 블록과 이유를 적는다 — 규칙을 끄는 변경이 늘 설정
  diff로 리뷰에 드러난다.

## 이유

주석 한 줄로 lint를 덮을 수 있으면 에이전트가 오류를 고치는 대신 덮는다. 끈 줄 알았는데 안 꺼진 죽은 주석도 남지 않게
주석 자체를 오류로 만든다.
