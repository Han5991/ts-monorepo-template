#!/usr/bin/env bash
# check-fix-patch.sh 회귀 테스트. 임시 저장소에서 패치를 만들어 통과·거부를 확인한다.
set -euo pipefail
# git 훅(pre-push)이 부르면 GIT_DIR 등이 이 저장소를 가리킨 채 넘어온다 — worktree에서는 절대 경로라 아래 임시 저장소의
# git init·reset이 진짜 저장소에 적용된다. 이 테스트의 git은 늘 임시 저장소만 보게 지운다.
unset $(git rev-parse --local-env-vars)
export LC_ALL=C.UTF-8

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-fix-patch.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# 패치는 저장소 밖에 둔다 — 안에 두면 git clean이 지운다
work="$tmp"
mkdir "$tmp/repo"
cd "$tmp/repo"
git init -q
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
# 전역 설정과 무관하게 git 기본값으로 — ASCII 밖의 경로를 따옴표로 감싼다
git config core.quotePath true
# 저장소와 같은 배치 — 허용 목록(앱·패키지의 src, scripts, 문서)의 안과 밖에 파일을 하나씩 둔다
mkdir -p packages/x/src packages/eslint-config scripts docs/adr .github/workflows .claude/skills/s
printf 'export const a = 1;\n' >packages/x/src/a.ts
printf 'it("a", () => {});\n' >packages/x/src/a.test.ts
printf '{"name":"x"}\n' >packages/x/package.json
printf '{"a":1}\n' >packages/x/설정.json
ln -s a.ts packages/x/src/link.ts
printf '{"compilerOptions":{"strict":true}}\n' >packages/x/tsconfig.json
printf 'export default [];\n' >packages/x/eslint.config.mts
printf 'export const base = [];\n' >packages/eslint-config/index.mts
printf '{"name":"root"}\n' >package.json
printf '{"tasks":{}}\n' >turbo.json
printf 'export {};\n' >scripts/init.ts
printf '# 결정\n' >docs/adr/0001-x.md
printf '# 저장소\n' >README.md
printf '# 지침\n' >AGENTS.md
ln -s AGENTS.md CLAUDE.md
printf '# 스킬\n' >.claude/skills/s/SKILL.md
printf 'name: ci\n' >.github/workflows/ci.yml
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base

failed=0
# 작업 트리를 바꾼 뒤 그 diff를 패치로 만들고 원복한다
patch_of() {
  eval "$1"
  git add -A -N
  git diff --binary HEAD >"$work/p.patch"
  git reset -q --hard
  git clean -qfd
}
expect() {
  local want="$1" name="$2" change="$3"
  patch_of "$change"
  if bash "$SCRIPT" "$work/p.patch" >/dev/null 2>&1; then got=pass; else got=reject; fi
  if [[ "$got" == "$want" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name — 기대 $want, 실제 $got"
    failed=1
  fi
}

# 허용 목록 안
expect pass '패키지 src의 소스 수정' "printf 'export const a = 2;\n' >packages/x/src/a.ts"
expect pass '패키지 src의 테스트 수정' "printf 'it(\"a\", () => { expect(1).toBe(1); });\n' >packages/x/src/a.test.ts"
expect pass '루트 scripts 수정' "printf 'export const b = 1;\n' >scripts/init.ts"
expect pass '루트 문서 수정' "printf '# 저장소(고침)\n' >README.md"
# 허용 목록 밖 — 설정·공통 규칙·CI·도구
expect reject '루트 package.json 수정' "printf '{\"name\":\"root\",\"scripts\":{\"postinstall\":\"curl x\"}}\n' >package.json"
expect reject '패키지 package.json 수정' "printf '{\"name\":\"x\",\"private\":true}\n' >packages/x/package.json"
expect reject 'tsconfig 수정' "printf '{\"compilerOptions\":{\"strict\":false}}\n' >packages/x/tsconfig.json"
expect reject '패키지 eslint 설정 수정' "printf 'export default [{ rules: {} }];\n' >packages/x/eslint.config.mts"
expect reject '공통 lint 규칙 수정' "printf 'export const base = [{}];\n' >packages/eslint-config/index.mts"
expect reject 'turbo.json 수정' "printf '{\"tasks\":{\"test\":{}}}\n' >turbo.json"
expect reject '.github 수정' "printf 'name: ci2\n' >.github/workflows/ci.yml"
expect reject '.claude 아래 문서 수정(.md라도)' "printf '# 스킬(고침)\n' >.claude/skills/s/SKILL.md"
# 허용 목록 밖 — 에이전트가 따르는 규칙
expect reject 'AGENTS.md 수정' "printf '# 지침(고침)\n' >AGENTS.md"
expect reject '결정 기록(docs/adr) 수정' "printf '# 결정(고침)\n' >docs/adr/0001-x.md"
# 경로를 읽을 수 없는 머리
expect reject '따옴표로 감싼 경로(ASCII 밖의 문자)' "printf '{\"a\":2}\n' >packages/x/설정.json"
# 파일 단위
expect reject '새 파일' "printf 'x\n' >packages/x/src/b.ts"
expect reject '파일 삭제' "rm packages/x/src/a.ts"
expect reject '테스트 삭제' "rm packages/x/src/a.test.ts"
expect reject '모드 변경' "chmod +x packages/x/src/a.ts"
expect reject '심볼릭 링크의 대상 바꾸기(허용 경로 안)' "ln -sfn a.test.ts packages/x/src/link.ts"
# 테스트를 끄거나 뒤집는 것
expect reject 'it.skip 추가' "printf 'it.skip(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject 'describe.only 추가' "printf 'describe.only(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject 'test.only 추가' "printf 'test.only(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '별칭 suite.only 추가' "printf 'suite.only(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject 'it.skipIf 추가' "printf 'it.skipIf(true)(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject 'it.runIf 추가' "printf 'it.runIf(false)(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject 'it.todo로 바꾸기' "printf 'it.todo(\"a\");\n' >packages/x/src/a.test.ts"
expect reject 'it.fails 추가' "printf 'it.fails(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '이어 붙인 describe.concurrent.skip' "printf 'describe.concurrent.skip(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '이어 붙인 it.skip.each' "printf 'it.skip.each([1])(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '줄을 나눠 붙인 수식어' "printf 'describe\n  .only(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '실행 중에 건너뛰기(ctx.skip)' "printf 'it(\"a\", ctx => {\n  ctx.skip();\n});\n' >packages/x/src/a.test.ts"
expect reject '실행 중에 건너뛰기(구조 분해한 skip)' "printf 'it(\"a\", ({ skip }) => {\n  skip();\n});\n' >packages/x/src/a.test.ts"
expect reject '다른 객체의 .skip() 호출도 — 보수적으로' "printf 'const edit = { skip: () => 1 };\nedit.skip();\n' >packages/x/src/a.test.ts"
expect reject '실행 중에 건너뛰기(ctx.skip?.())' "printf 'it(\"a\", ctx => {\n  ctx.skip?.();\n});\n' >packages/x/src/a.test.ts"
expect reject '대괄호로 꺼낸 수식어' "printf 'it[\"only\"](\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '부르지 않고 참조만 한 수식어' "printf 'const later = it.skip;\nlater(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect reject '옵션 객체로 끄기(skip: true)' "printf 'it(\"a\", { skip: true }, () => {});\n' >packages/x/src/a.test.ts"
expect reject '옵션 객체로 끄기(값이 식)' "printf 'it(\"a\", { only: process.env.CI === undefined }, () => {});\n' >packages/x/src/a.test.ts"
expect pass '값이 숫자·문자열인 같은 이름의 키(예시 도메인)' "printf 'const counts = { todo: 0, done: 2 };\nconst next = { todo: \"doing\" };\n' >packages/x/src/a.test.ts"
expect reject '내용이 +로 시작하는 줄' "printf '+it.skip(\"a\", () => {});\n' >packages/x/src/a.test.ts"
expect pass '끄지 않는 수식어(it.concurrent·it.each)' "printf 'it.concurrent(\"a\", () => {});\nit.each([1])(\"b\", () => {});\n' >packages/x/src/a.test.ts"
expect pass '이름에 skip이 들었을 뿐인 값' "printf 'const skipped = [1].filter(isSkippable);\n' >packages/x/src/a.test.ts"
# 타입 검사를 끄는 주석
expect reject '@ts-ignore 추가' "printf '// @ts-ignore\nexport const a = 1;\n' >packages/x/src/a.ts"
expect reject '@ts-nocheck 추가' "printf '// @ts-nocheck\nexport const a = 1;\n' >packages/x/src/a.ts"
expect reject '설명을 붙인 @ts-expect-error 추가' "printf '// @ts-expect-error 이유를 적어도 거부한다\nexport const a = 1;\n' >packages/x/src/a.ts"

# 빈 패치
: >"$work/p.patch"
if bash "$SCRIPT" "$work/p.patch" >/dev/null 2>&1; then echo "FAIL 빈 패치 — 통과됨"; failed=1; else echo "ok   빈 패치"; fi

# 적용되지 않는 패치(다른 내용 기준으로 만든 diff)
printf 'export const a = 3;\n' >packages/x/src/a.ts
git diff >"$work/p.patch"
git checkout -q -- packages/x/src/a.ts
printf 'export const zzz = 9;\n' >packages/x/src/a.ts
git -c user.name=t -c user.email=t@t commit -qam drift
if bash "$SCRIPT" "$work/p.patch" >/dev/null 2>&1; then echo "FAIL 적용 안 되는 패치 — 통과됨"; failed=1; else echo "ok   적용 안 되는 패치"; fi

exit "$failed"
