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
mkdir -p src .github/workflows
printf 'export const a = 1;\n' >src/a.ts
printf 'it("a", () => {});\n' >src/a.test.ts
printf '{"name":"x"}\n' >package.json
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

expect pass '추적 중인 소스 수정' "printf 'export const a = 2;\n' >src/a.ts"
expect pass '테스트 수정' "printf 'it(\"a\", () => { expect(1).toBe(1); });\n' >src/a.test.ts"
expect reject '새 파일' "printf 'x\n' >src/b.ts"
expect reject '파일 삭제' "rm src/a.ts"
expect reject '테스트 삭제' "rm src/a.test.ts"
expect reject 'package.json 수정' "printf '{\"name\":\"x\",\"scripts\":{\"postinstall\":\"curl x\"}}\n' >package.json"
expect reject '.github 수정' "printf 'name: ci2\n' >.github/workflows/ci.yml"
expect reject 'it.skip 추가' "printf 'it.skip(\"a\", () => {});\n' >src/a.test.ts"
expect reject 'describe.only 추가' "printf 'describe.only(\"a\", () => {});\n' >src/a.test.ts"
expect reject '@ts-ignore 추가' "printf '// @ts-ignore\nexport const a = 1;\n' >src/a.ts"
expect reject '모드 변경' "chmod +x src/a.ts"

# 빈 패치
: >"$work/p.patch"
if bash "$SCRIPT" "$work/p.patch" >/dev/null 2>&1; then echo "FAIL 빈 패치 — 통과됨"; failed=1; else echo "ok   빈 패치"; fi

# 적용되지 않는 패치(다른 내용 기준으로 만든 diff)
printf 'export const a = 3;\n' >src/a.ts
git diff >"$work/p.patch"
git checkout -q -- src/a.ts
printf 'export const zzz = 9;\n' >src/a.ts
git -c user.name=t -c user.email=t@t commit -qam drift
if bash "$SCRIPT" "$work/p.patch" >/dev/null 2>&1; then echo "FAIL 적용 안 되는 패치 — 통과됨"; failed=1; else echo "ok   적용 안 되는 패치"; fi

exit "$failed"
