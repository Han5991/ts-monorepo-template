---
date: 2026-11-21
status: accepted
---

# 타입 정보를 쓰는 lint 규칙(any 흘리기·기다리지 않은 promise 등)을 공통 설정에서 모든 TS 파일에 켠다

## 결정

- 공통 설정(`base`)이 typescript-eslint의 타입 정보를 쓰는 규칙(`recommendedTypeChecked`에서 `recommended`를 뺀 몫인
  `recommendedTypeCheckedOnly`)을 모든 TS 파일에 오류로 켠다. 패키지마다 켜는 단계는 없다 — `base`를 펼치는 패키지는 새 패키지도
  저절로 들어온다. 테스트 파일과 설정 파일(`eslint.config.mts`)도 예외가 아니다. 선언 파일(`.d.ts` 등)만 뺀다 — ADR 0020이
  파일째 막아 이 규칙들이 볼 것이 없다.
  - 바깥 입력에서 흘러드는 `any` — `no-unsafe-member-access`·`no-unsafe-assignment`·`no-unsafe-argument`·`no-unsafe-return`·
    `no-unsafe-call`. `JSON.parse`·`res.json()`의 결과는 `unknown`으로 받아 좁힌다(ADR 0016). `unknown`에 넣는 것은 걸리지 않는다.
  - promise — `no-floating-promises`·`no-misused-promises`·`await-thenable`·`require-await`.
  - 문자열로 찍으면 `'[object Object]'`가 되는 값 — `no-base-to-string`·`restrict-template-expressions`.
- 파일마다 가장 가까운 tsconfig 프로젝트의 타입으로 판단한다(`projectService`). 어느 tsconfig에도 없는 TS 파일은 건너뛰지 않고
  lint가 파싱 오류로 멈춘다 — 그 파일을 tsconfig에 넣는다(그래야 tsc도 그 파일을 본다).
- `tsconfigRootDir`는 워크스페이스 루트 하나다. project service는 tsconfig를 이 디렉터리까지만 찾으므로, 루트로 둬야 패키지
  tsconfig(src만 본다) 밖의 `eslint.config.mts`를 루트 `tsconfig.json`(도구 파일 프로젝트, `pnpm check-types:tooling`)으로 찾는다.
- 이 블록은 `base` 안에서 `recommended` 다음, `base`가 옵션을 바꾼 규칙 블록 앞에 둔다 — `base`의 옵션이 늘 이긴다.
- 예외를 여는 방법은 ADR 0007·0016과 같다. 그 패키지의 `eslint.config.mts`에 좁은 `files` 블록으로 해당 규칙만 끄고 이유를 적은 뒤,
  PR 설명에 위치와 이유를 적는다.
- 가드 테스트(`packages/eslint-config/guards.test.mts`)가 규칙 묶음마다 막히는지, 루트와 패키지마다(목록은 저장소를 읽어 만든다)
  소스·테스트·설정 파일에서 막히는지, `unknown`에서 좁힌 코드는 통과하는지(양성 대조) 본다.
  - 탐침은 저장소에 있는 파일의 경로로 넣는다. 타입 정보는 디스크에 있는 파일로 만든 프로젝트에서만 나와서 없는 경로는 파싱 오류가
    난다. 검사 뒤에는 그 파일의 실제 내용으로 다시 lint해 되돌린다 — project service는 프로세스에 하나이고 연 내용을 그대로 들고
    있어서, 안 되돌리면 뒤 검사가 바뀐 타입을 본다.
  - 가드 테스트는 한 번만 도는 실행(single run)이 아니라고 알린다(`TSESTREE_SINGLE_RUN=false`). typescript-eslint는 CI(`CI=true`)를
    single run으로 보고, 내용이 디스크와 같은 파일은 디스크로 만든 Program에서 읽는다 — 그러면 되돌리기가 project service에 닿지 않는다.
  - 처음 보는 tsconfig 프로젝트를 읽는 검사는 몇 초 걸려 Vitest 기본 시간 제한(5초)을 넘을 수 있다. 시간 예산을 넉넉히 준다.
  - 이 테스트는 다른 패키지의 타입까지 읽으므로 turbo가 캐시하지 않는다.

## 이유

ADR 0016은 단언을 막았지만 `any`는 단언 없이 들어온다. `JSON.parse`·`res.json()`은 `any`를 돌려주고, `any`는 어떤 타입의 자리에도
들어가 엄격 타입 설정을 조용히 비켜 간다. 기다리지 않은 promise(실패가 사라진다)와 `'[object Object]'`로 찍히는 문자열도 같은
종류다 — 타입을 봐야 보이는 실수라 타입 정보 없는 규칙은 못 본다.

켜기 전에 센 위반은 15건(프로덕션 4·테스트 11)이었고 예외 없이 고쳤다. 바깥 입력 11곳은 이미 `unknown`으로 받고 있었다 — 이
규칙은 있는 것을 고치기보다 다음에 `any`가 새는 것을 막는다.

패키지마다 켜는 함수(`typeChecked(tsconfigRootDir, files)`)로 두지 않은 이유: 켜는 것을 잊은 패키지는 조용히 빠지고, 같은 호출이
패키지 수만큼 복사되고, 패키지 tsconfig 밖의 설정 파일을 덮지 못한다. `base`에 두면 덮이지 않는 파일은 lint가 멈추는 쪽(시끄러운
쪽)이 된다.

`tsconfigRootDir`를 명시하는 이유가 하나 더 있다. 한 프로세스가 여러 패키지 설정을 읽으면(에디터의 ESLint 서버·가드 테스트)
typescript-eslint는 tsconfig 루트 후보가 여럿이라며 파싱을 거부한다. 전에는 `layers()`가 `src`에만 패키지 경로를 적어, 그런
프로세스에서 두 번째 패키지부터 `eslint.config.mts`가 파싱되지 않았다(재현). 모든 TS 파일에 한 값을 두고 `layers()`의 값은 지웠다.

비용(4코어에서 잼): 패키지 lint 하나가 약 1초에서 2.5~3.7초로 늘었다(그중 0.6~1초는 설정 파일 때문에 루트 tsconfig 프로젝트를 읽는
몫). 캐시 없는 전체 lint(turbo)는 약 3초에서 12초, 가드 테스트는 약 1.4초에서 8초.

출처(확인 2026-11-21):

- typescript-eslint 8.72.2의 `recommendedTypeCheckedOnly` 규칙 목록:
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/eslint-plugin/src/configs/flat/recommended-type-checked-only.ts
- project service가 `tsconfigRootDir`를 tsconfig를 찾는 상한(TypeScript `openClientFile`의 `projectRootPath`)으로 넘긴다:
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/typescript-estree/src/useProgramFromProjectService.ts
- project service는 프로세스에 하나다(모듈 변수에 처음 한 번 만든다):
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/typescript-estree/src/parseSettings/createParseSettings.ts
- `projectService`를 쓰면 `CI=true`일 때 single run으로 보고, `TSESTREE_SINGLE_RUN=false`면 single run이 아니다:
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/typescript-estree/src/parseSettings/inferSingleRun.ts
- single run에서는 내용이 디스크와 같은 파일을 tsconfig마다 한 번 만든 Program에서 읽고, 다를 때만 project service로 간다
  (`useSingleRunProgramForProjectService`):
  https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.2/packages/typescript-estree/src/parser.ts
- TypeScript 5.7부터 가장 가까운 tsconfig.json이 파일을 담지 않으면 위 디렉터리의 tsconfig.json을 계속 찾는다:
  https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%205.7.md
