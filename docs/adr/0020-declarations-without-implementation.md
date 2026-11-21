---
date: 2026-11-21
status: accepted
---

# 오버로드 시그니처·앰비언트 값 선언(`declare`)·`.d.ts`도 lint로 막는다

## 결정

- 공통 설정(`base`)이 구현 없이 타입을 주장하는 선언 셋을 더 막는다. ADR 0016·0018과 같이 테스트 파일도 예외가 아니다.
  - 오버로드 시그니처(함수·메서드·생성자) — `local/no-overload-signature`. 본문 없는 함수·메서드 가운데 앰비언트가 아닌 것이다
    (`TSDeclareFunction`·본문 없는 `MethodDefinition`, `declare`·앰비언트 블록 안은 뺀다). abstract 메서드와 인터페이스의 호출
    시그니처는 걸리지 않는다.
  - 앰비언트 값 선언 — `local/no-ambient-value`. `declare const`·`let`·`var`·`function`·`class`·`enum`, `declare global`·
    `declare module`·`declare namespace` 안의 같은 선언, 본문 없는 `declare module 'x';`(셀렉터 `[declare=true]:not([body])`)다.
  - 선언 파일(`.d.ts`·`.d.mts`·`.d.cts`·`.d.<확장자>.ts`) — `local/no-declaration-file`. 파일 자체를 막는다(선언 파일에서만 켜고
    셀렉터는 `Program`).
- 앰비언트 블록 안의 타입만인 선언(`interface`·`type`)은 그대로 허용한다. ADR 0011이 최상위에 둘 수 있는 선언으로 정한 "타입만인
  `declare global`·`declare module`"이고, 이제 그 "타입만인"을 lint가 지킨다.
- 막히면 구현이 있는 코드로 바꾼다.
  - 오버로드 대신 입력마다 함수를 나누거나, 합집합을 받고 돌려준 뒤 호출부가 좁힌다. 입력의 종류에 따라 반환 타입이 바뀌어야
    하면, 이름으로 인덱싱한 mapped type(`{ [K in Kind]: (s: string) => Out[K] }`)에 구현을 두고 `K`로 찾아 부른다. 이것은 TS가
    키마다 확인한다. 조건부 반환 타입(`T extends string ? A : B`)은 대안이 아니다 — 구현에서 단언 없이 돌려줄 수 없다.
  - 앰비언트 값 대신 값은 모듈에서 import한다. 바깥에서 오는 값(전역·환경 변수·타입이 없는 패키지)은 `unknown`으로 받아 스키마로
    파싱하는 모듈을 하나 둔다.
  - 선언 파일 대신 타입은 `.ts`에 둔다. 도구가 만드는 타입 참조(`/// <reference types="…" />`)는 tsconfig의 `types`로 옮긴다.
- 셋도 ADR 0018의 규칙처럼 공통 설정 패키지가 정의하는 규칙이다(`no-restricted-syntax`가 아니다). 예외를 여는 방법은 ADR
  0007·0016과 같다.
- 도메인의 `noTopLevelEffects`(ADR 0011)는 본문 없는 함수 선언을 계속 허용 선언으로 둔다. 부작용이 없는 선언이라 그 규칙의 판단으로는
  맞고, 이 결정의 예외를 연 경우에만 닿는다.
- 가드 테스트(`packages/eslint-config/guards.test.mts`)가 꼴마다 막히는지, 테스트 파일에서도 막히는지, 선언 파일이 타입만 담아도
  확장자를 바꿔도(`.d.mts`·`.d.cts`·`.d.css.ts`) 막히는지, 타입만인 보강·abstract 메서드·호출 시그니처가 통과하는지(양성 대조)를 본다.
- lint가 못 보는 것 — 규칙으로만 남기고 리뷰에서 본다.
  - 타입만인 보강이 이미 있는 값에 없는 멤버를 더하는 것. `declare global { interface String { toTask(): Task } }`를 두면
    `'x'.toTask()`가 컴파일되고 실행하면 `TypeError`다. 라이브러리가 권하는 보강(전역 `Window`, 컨텍스트 변수 타입 등)도 같은
    꼴이라 막지 않았다.
  - 라이브러리에서 흘러드는 `any`(ADR 0016).

## 이유

오버로드 시그니처는 단언이다. TS는 구현 시그니처가 오버로드와 "호환"되는지만 보고, 어떤 입력에 어떤 값을 돌려주는지는 보지 않는다.
그래서 `function cast(x: unknown): T; function cast(x: unknown): unknown { return x }`가 컴파일된다. 문자열을 받으면 `number`를
돌려준다고 적어 두고 구현은 문자열을 돌려줘도, 클래스 메서드 오버로드도 마찬가지다(TS 6.0.3에서 위반을 넣어 확인). 매개변수를
구현보다 넓히는 오버로드는 TS가 막고(TS2394), 인터페이스의 호출 시그니처는 구현을 대입할 때 확인한다 — 그래서 그 둘은 막지
않는다. 정직한 오버로드와 거짓 오버로드는 lint가 가르지 못한다. 반환 타입이 맞는지는 뜻의 문제다. 그래서 타입 서술(ADR 0018)처럼
모두 막는다. TypeScript 핸드북도 되도록 오버로드 대신 합집합 매개변수를 쓰라고 적는다.

<!-- module:api:start -->

이름으로 인덱싱한 mapped type은 계약의 `ENDPOINTS`가 이미 쓰는 꼴이다(ADR 0002).

<!-- module:api:end -->

앰비언트 값 선언은 구현 없이 "이 값이 있고 이 타입이다"라고 주장한다. `declare const config: Config`는 값이 없으면 실행할 때
`ReferenceError`가 나고, `declare function parse(x: unknown): Task`는 서술 없이도 캐스트가 된다. `declare global` 안에 함수를 선언하면
lib 함수에 오버로드가 더해진다 — `function parseInt(x: unknown): T`를 더하면 `parseInt(1)`이 `T`로 컴파일되고 실행하면 숫자 `1`이다.
ADR 0018을 넣은 변경의 리뷰가 이 길을 짚었고, 위반을 넣어 확인했다.

본문 없는 `declare module 'untyped-lib';`는 그 모듈에서 가져오는 것을 모두 `any`로 만든다 — `.d.ts`에 두면 `lib.whatever.deep()`이
`number` 자리에 컴파일된다(확인). `.ts`에서는 공통 tsconfig의 `moduleDetection: "force"`가 파일을 모듈로 보게 해 tsc가 모듈 보강
오류(TS2664)로 막지만, 그 설정이나 `.d.ts` 예외에 기대지 않도록 lint가 따로 막는다.

`.d.ts`는 파일 안의 선언이 `declare` 없이도 앰비언트라, `export const c: number;`가 위 두 규칙 어디에도 걸리지 않았다(확인).
셀렉터는 파일 이름을 모르므로 파일째 막는다. TS는 `.d.mts`·`.d.cts`(TS 4.7)와 임의 확장자의 `.d.<확장자>.ts`(TS 5.0)도 선언 파일로
보므로 이름 패턴도 넷 모두다 — `.d.ts`만 잡으면 확장자만 바꿔 빠져나간다(#35 리뷰가 짚었고, TS 6.0.3에서 넷 모두
`export const c: number;`를 받는 것을 확인). 이 저장소는 TS만 쓰고 선언 파일이 하나도 없어서, 필요해질 때 이유를 적고 여는 편이 싸다.

타입만인 보강까지 막으면 ADR 0011이 허용한 선언을 거두고, 라이브러리가 권하는 확장 방식(모듈 보강)도 막게 된다. 그 꼴이 할 수 있는
거짓은 이미 있는 값에 멤버를 더하는 것뿐이라 리뷰에서 본다.

결정할 때 위반은 셋 다 0건이었다(git이 추적하는 TS 파일 69개, `.d.ts` 0개). 바뀐 것은 도메인 양성 대조의 오버로드 예시 하나다.

출처(확인 2026-11-21):

- TypeScript 핸드북 "More on Functions" — 구현 시그니처는 밖에서 보이지 않고 오버로드와 "compatible"하기만 하면 된다, "Always prefer
  parameters with union types instead of overloads when possible":
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/handbook-v2/More%20on%20Functions.md
- TypeScript 핸드북 "Declaration Merging"의 "Global augmentation" — 모듈 안에서 `declare global`로 전역에 선언을 더한다:
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/reference/Declaration%20Merging.md
- TypeScript 핸드북 "Declaration Reference" — `declare function`·`declare class`는 이미 있는 값의 모양을 서술한다:
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/declaration-files/By%20Example.md
- TypeScript 4.7 릴리스 노트 — 새 선언 파일 확장자 `.d.mts`·`.d.cts`:
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%204.7.md
- TypeScript 5.0 릴리스 노트의 `allowArbitraryExtensions` — 임의 확장자의 선언 파일(`app.d.css.ts`):
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%205.0.md
