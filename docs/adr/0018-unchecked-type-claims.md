---
date: 2026-11-21
status: accepted
---

# 타입 서술(`x is T`·`asserts x`)·확정 대입(`x!: T`)·`declare` 필드도 lint로 막는다

## 결정

- 공통 설정(`base`)이 컴파일러가 확인하지 않는 타입 주장 셋을 더 막는다. ADR 0016과 같이 테스트 파일도 예외가 아니다.
  - 손으로 적은 타입 서술과 단언 시그니처(`x is T`·`this is T`·`asserts x is T`·`asserts x`) — `local/no-type-predicate`, 셀렉터
    `TSTypePredicate`. 함수 본문·오버로드·`declare`·타입 별칭 어디에 적었든 막는다.
  - 확정 대입 단언(`let x!: T`, 필드·`accessor` 필드 `x!: T`) — `local/no-definite-assignment-assertion`, 셀렉터 `[definite=true]`.
  - `declare` 필드(`declare x: T`) — `local/no-declare-field`, 셀렉터 `PropertyDefinition[declare=true]`. 최상위 `declare` 값
    선언과 앰비언트 블록 안의 값은 이 규칙이 아니라 ADR 0019의 `local/no-ambient-value`가 막는다.
- 막히면 컴파일러가 확인하는 코드로 바꾼다.
  - 가드가 필요하면 반환 타입을 적지 않는다. TS가 본문이 실제로 좁히는 만큼만 서술을 추론한다(`x => typeof x === 'string'`).
  - 문자열이 목록의 값인지는 목록에서 찾아 그 값을 돌려받는다(`NAMES.find(n => n === v)`, 타입은 `Name | undefined`).
  - 이름 목록과 그 이름으로 찾는 객체가 둘 다 필요하면 이름 튜플을 출처로 두고 객체를 `satisfies Record<Name, …>`로 맞춘다.
    `Object.keys`가 준 `string[]`을 다시 좁히지 않는다.
  - 바깥 입력은 지금처럼 스키마(zod)로 파싱한다.
  - 확정 대입·`declare` 대신 선언할 때 값을 주거나 생성자에서 대입한다. 없을 수 있으면 `| undefined`로 적고 쓰는 곳에서 확인한다.
- 경계에도 예외를 두지 않는다. 예외를 여는 방법은 ADR 0007·0016과 같다(그 패키지 설정의 좁은 `files` 블록과 이유).
- 셋은 `no-restricted-syntax`가 아니라 공통 설정 패키지가 정의하는 규칙(`local/…`)이다. `no-restricted-syntax`는 설정 블록마다
  통째로 덮어써져서, 공통 설정에 두면 자기 목록을 둔 패키지(도메인의 `noTopLevelEffects`, ADR 0011)에서 조용히 빠진다. 이름이
  따로면 덮일 수 없고, 예외를 열 때도 그 규칙 하나만 꺼진다. `no-restricted-syntax`는 패키지가 자기 목록에 쓴다.
- 가드 테스트(`packages/eslint-config/guards.test.mts`)가 꼴마다 막히는지, 테스트 파일에서도 막히는지, 도메인의
  `no-restricted-syntax`와 함께 걸리는지, 추론된 서술·`find`·초기값·생성자 대입이 통과하는지(양성 대조)를 본다.
- lint가 못 보는 것 — 규칙으로만 남기고 리뷰에서 본다.
  - 라이브러리에서 흘러드는 `any`(ADR 0016).
- 이 결정 때 "lint가 못 보는 것"으로 남긴 오버로드 시그니처와 앰비언트 값 선언(`.d.ts` 포함)은 ADR 0019가 이어서 막는다.

## 이유

타입 서술은 단언이다. TS는 `x is T`를 적은 함수가 boolean을 돌려주기만 하면 본문이 그 서술과 맞는지 보지 않는다. TypeScript 5.5
릴리스 노트도 명시적 서술은 타입 단언(`as`)보다 안전하지 않다고 적는다. 단언 시그니처(`asserts`)는 본문이 던지는지도 보지 않는다.
그래서 `as`를 막은 뒤에는 `(x: unknown): x is T => true`나 본문이 빈 `asserts x is T {}`가 같은 일을 하는 가장 싼 길이었다. 서술을
붙인 오버로드에 boolean 구현을 다는 꼴도 컴파일된다(TS 6.0.3에서 위반을 넣어 확인).

확인하는 가드와 확인하지 않는 가드를 lint는 가르지 못한다. 확인이 충분한지는 뜻의 문제라, 표기(`=> true`)만 막으면 같은 뜻의 다른
표기가 통과한다. 참만 돌려주는 가드의 흔한 꼴 `(x: unknown): x is T => true`는 매개변수를 타입에서만 써서 `no-unused-vars`에
우연히 걸렸지만, 이름을 `_x`로 바꾸면 통과했다. 그래서 손으로 적은 서술은 모두 막는다. 막아도 길이 있다. TS 5.5부터 반환 타입을
적지 않은 함수는 본문이 매개변수를 좁히면 서술이 추론되고, 이 서술은 컴파일러가 본문에서 확인한 것이다.

타입 위치의 서술(함수 타입·인터페이스 메서드)은 그 자체로는 거짓이 아니다. TS가 boolean 구현을 그 자리에 대입하지 않는다(확인). 그래도
함께 막는다. 본문 없이 서술을 적는 오버로드·`declare`와 꼴이 같고, 지금 쓰는 곳이 없고, 셀렉터가 노드 하나로 끝난다. 고차 함수의
시그니처에 필요해지면 ADR 0007의 방법으로 연다.

확정 대입 단언은 non-null 단언(`!`)과 같은 일을 선언에서 한다. 엄격 설정이 켠 초기화 검사(대입 전 사용, 필드 초기화)를 확인 없이
끈다. `no-non-null-assertion`은 식(`TSNonNullExpression`)만 듣고 선언의 `!`는 보지 않는다. `declare` 필드는 같은 검사를 끄면서
실행할 때 필드를 만들지 않는다. 값은 `undefined`인데 타입은 `T`로 남는다. 확정 대입만 막으면 한 단어만 바꿔 같은 길이 열린다.

경계에 예외를 두지 않는 것은 필요한 경계가 없어서다. 실제 경계(HTTP 파라미터·응답, DB 행, 환경 변수, 파일·레지스트리 JSON)는
이미 zod로 파싱한다. 결정 전에 있던 서술 2건도 경계 검사가 아니었다. 하나는 `Object.keys`가 준 `string[]`을 이름 타입으로 다시
좁혔고, 하나는 CLI 인자를 목록과 비교했다. 둘 다 서술 없이 바꾼 뒤 규칙을 0건에서 켰다(확정 대입·`declare` 필드는 처음부터
0건이었다). 경계 파일이나 폴더를 예외로 열면 그 자리가 아무 서술이나 두는 뒷문이 된다.

<!-- module:api:start -->

앞의 것(계약의 `isEndpointName`)은 정당해 보였지만 틀렸다. `key in ENDPOINTS`로 판정해서 `'toString'`·`'constructor'`에도
참이었다(`in`은 프로토타입 체인까지 본다). 넣는 값이 늘 `Object.keys(ENDPOINTS)`라 드러나지 않았을 뿐, 하는 일은 `string[]`을
`EndpointName[]`으로 바꾸는 단언이었다. 지금은 이름 튜플이 출처이고, 엔드포인트 정의는 `satisfies`로 그 이름에 맞춘다.

<!-- module:api:end -->

셀렉터를 공통 설정의 `no-restricted-syntax`에 넣어 보니 다른 패키지와 도메인 테스트 파일에서는 걸리고, 도메인 프로덕션 파일에서만
빠졌다. 공통 항목을 늘 앞에 붙여 `no-restricted-syntax`를 만드는 합성 함수로도 덮어쓰기는 피할 수 있다. 하지만 패키지가 그 함수를
거치지 않고 `no-restricted-syntax`를 쓰면 다시 조용히 빠지고, 한 파일에서 서술 금지만 풀려면 `noTopLevelEffects`까지 꺼야 한다.
규칙 접두에 워크스페이스 스코프를 쓰지 않는 것은 init이 글에 적힌 스코프를 새 프로젝트 이름으로 바꾸기 때문이다. 스코프를 쓰면
규칙을 가리키는 글만 바뀌고 규칙 이름은 그대로 남는다.

출처(확인 2026-11-21):

- TypeScript 5.5 릴리스 노트 "Inferred Type Predicates" — 서술을 추론하는 조건(반환 타입·서술을 적지 않았고, `return`이 하나이고,
  매개변수를 바꾸지 않고, 매개변수를 좁히는 boolean 식을 돌려준다)과 "Explicit type predicates ("is") are no safer than a type
  assertion ("as")":
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%205.5.md
- TypeScript 2.7 릴리스 노트 "Definite Assignment Assertions" — 분석이 대입을 찾지 못해도 대입됐다고 알리는 `!`, non-null 단언의 짝:
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%202.7.md
- TypeScript 3.7 릴리스 노트 "The `useDefineForClassFields` Flag and The `declare` Property Modifier" — `declare`는 그 필드를
  내보내지 않는다는 표시:
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%203.7.md
- ESLint 10.15.0 "Configure Rules" — 같은 규칙을 여러 설정 객체가 정하면 뒤의 것이 이긴다. 심각도만 적으면 앞의 옵션이 남고, 옵션을
  적으면 바뀐다: https://raw.githubusercontent.com/eslint/eslint/v10.15.0/docs/src/use/configure/rules.md
- ESLint 10.15.0 "Selectors" — 직접 만든 규칙도 셀렉터로 노드를 듣는다:
  https://raw.githubusercontent.com/eslint/eslint/v10.15.0/docs/src/extend/selectors.md
- typescript-eslint 8.72.2 `no-non-null-assertion` — `TSNonNullExpression`만 듣는다:
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/eslint-plugin/src/rules/no-non-null-assertion.ts
- MDN `in` 연산자 — 프로토타입 체인의 속성에도 참:
  https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/reference/operators/in/index.md
