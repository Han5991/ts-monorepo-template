---
date: 2026-11-21
status: accepted
---

# 타입 오류를 단언(`as`·`!`)이나 `@ts-expect-error`로 덮지 못하게 lint로 막는다

## 결정

- 공통 설정(`base`)이 타입 오류를 고치는 대신 덮는 문법 셋을 오류로 만든다. 테스트 파일도 예외가 아니다.
  - 타입 단언 `x as T`·`<T>x` — `@typescript-eslint/consistent-type-assertions`(`assertionStyle: 'never'`).
    `as const`와 `satisfies`는 걸리지 않는다. 그대로 쓴다.
  - non-null 단언 `x!` — `@typescript-eslint/no-non-null-assertion`.
  - `@ts-expect-error` — `@typescript-eslint/ban-ts-comment`. 설명을 붙여도 막는다(`@ts-ignore`·`@ts-nocheck`는 규칙 기본값으로
    이미 막힌다).
- 막히면 타입으로 고친다. 바깥 입력(JSON·fetch 응답·환경 변수)은 `unknown`으로 받아 스키마(zod)나 `typeof`·`in`으로 좁히고,
  없을 수 있는 값은 확인해서 없을 때의 동작을 적는다. 타입이 실제와 다르면 그 타입의 출처를 고친다.
- 예외를 여는 방법은 ADR 0007과 같다. 그 패키지의 `eslint.config.mts`에 좁은 `files` 블록으로 해당 규칙만 끄고 이유를 주석으로
  적은 뒤, PR 설명에 위치와 이유를 적는다. 공통 설정(`base`)에서는 풀지 않는다.
- 가드 테스트(`packages/eslint-config/guards.test.mts`)가 위반마다 막히는지와 `as const`·`satisfies`가 통과하는지(양성 대조)를
  본다.
- lint가 못 보는 것 — 규칙으로만 남기고 리뷰에서 본다.
  - 라이브러리에서 흘러드는 `any`(`JSON.parse`, `res.json()`). 타입 정보를 쓰는 규칙(`typeChecked`)이 볼 일이다.
- 확정 대입 단언(`x!: T`)과, 확인하지 않고 참을 돌려주는 타입 가드(`x is T`)는 ADR 0018이 이어서 막는다.

## 이유

AGENTS.md는 오류를 단언으로 덮지 말라고 적어 두었지만 실행 경로에는 그 규칙이 없었다. typescript-eslint의 `recommended`에는 셋
가운데 `ban-ts-comment`만 있고, 그 기본값은 설명을 붙인 `@ts-expect-error`를 허용한다. 그래서 `as`와 `!`, 설명을 붙인
`@ts-expect-error`가 lint를 그대로 통과했다(위반을 넣어 확인). 글로만 있는 규칙은 잊힌다(ADR 0001).

타입 오류 앞에서 가장 싼 길은 단언이고, 에이전트는 오류를 고치는 대신 그 길을 고른다(ADR 0007과 같은 이유). 단언은 오류를
없애지 않고 컴파일할 때에서 실행할 때로 옮긴다. 엄격 타입 설정이 붙여 준 `| undefined`도 `!` 한 글자로 지워지면 켜 둔 의미가
없다. `@ts-expect-error`는 설명이 있어도 그 줄의 오류를 무엇이든 삼켜서, 처음 가리려던 오류가 다른 오류로 바뀌어도 조용하다.

`as const`와 `satisfies`는 반대 방향이다. 값의 타입을 좁히거나 값이 타입에 맞는지 검사를 더할 뿐, 컴파일러의 판단을 뒤집지
않는다.

출처(typescript-eslint 8.72.2의 저장소 원본, 확인 2026-11-21):

- `recommended`에 든 규칙:
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/eslint-plugin/src/configs/flat/recommended.ts
- `ban-ts-comment`의 기본값(`@ts-expect-error`는 설명이 있으면 허용, `@ts-ignore`·`@ts-nocheck`는 금지):
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/eslint-plugin/docs/rules/ban-ts-comment.mdx
- `consistent-type-assertions`는 const 단언을 늘 허용한다:
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/eslint-plugin/docs/rules/consistent-type-assertions.mdx
