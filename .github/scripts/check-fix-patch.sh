#!/usr/bin/env bash
# Claude가 낸 수정 패치를 LLM 없이 검사한다. 통과하면 0, 거부하면 이유를 찍고 1.
# 현재 디렉터리는 패치를 적용할 저장소(실패한 커밋으로 checkout된 상태)여야 한다.
#
# 받는 것(허용 목록 — ALLOWED): 이미 git이 추적하는 텍스트 파일 가운데 앱·패키지의 src(소스·테스트), 루트 scripts, 문서
# (docs/와 루트 .md)의 수정만. 목록 밖은 모두 거부한다 — 설정(package.json·lockfile·tsconfig·eslint·turbo·prettier 등),
# 공통 lint 규칙(packages/eslint-config), CI·도구(.github·.claude·lefthook·renovate). 규칙을 풀어 CI를 초록으로 만드는 길을
# 막고, 새로 생기는 설정 파일도 목록에 없으니 그대로 막힌다. 설정을 꼭 바꿔야 하는 실패는 사람이 고친다(멘션이 간다).
# 그 밖에 거부하는 것:
#   - 새 파일·삭제·이름 바꾸기·모드 변경·심볼릭 링크(대상 바꾸기 포함)·바이너리
#   - 테스트를 끄거나 뒤집는 것: 수식어(.skip·.only·.skipIf·.runIf·.todo·.fails — it·test·describe와 그 별칭 suite에,
#     .concurrent.skip·.skip.each처럼 이어 붙이거나 줄을 나눠 붙여도), 실행 중에 건너뛰는 skip() 호출(ctx.skip()·구조 분해한
#     skip()) — 다른 객체의 .skip() 호출도 보수적으로 거부한다
#   - 타입 검사를 끄는 주석(@ts-ignore·@ts-nocheck·@ts-expect-error — 설명을 붙여도)
#   - 저장소에 적용되지 않는 패치
#
# 회귀 테스트: bash .github/scripts/check-fix-patch.test.sh (CI의 quality-checks가 돌린다)
set -euo pipefail
export LC_ALL=C.UTF-8

patch="${1:?사용: check-fix-patch.sh <패치 파일>}"
[[ -s "$patch" ]] || { echo "거부: 패치가 비었다"; exit 1; }

ALLOWED='^((apps|packages)/[^/]+/src/|scripts/|docs/|[^/]+\.md$)'

reasons=()
while IFS= read -r line; do
  case "$line" in
    'new file mode '*) reasons+=("새 파일") ;;
    'deleted file mode '*) reasons+=("파일 삭제") ;;
    'rename from '* | 'copy from '*) reasons+=("이름 바꾸기·복사") ;;
    'old mode '* | 'new mode '*) reasons+=("모드 변경") ;;
    'GIT binary patch' | 'Binary files '*) reasons+=("바이너리") ;;
    # 심볼릭 링크의 대상을 바꾸면 모드 줄 없이 index 줄에만 링크 모드(120000)가 남는다
    'index '*' 120000') reasons+=("심볼릭 링크") ;;
  esac
done <"$patch"

while IFS= read -r path; do
  [[ "$path" =~ $ALLOWED ]] || reasons+=("허용 목록 밖의 경로: $path")
done < <(sed -n 's#^diff --git a/\(.*\) b/.*$#\1#p' "$patch" | sort -u)

# 추가된 줄 — 덩어리(@@) 안에서 +로 시작하는 줄. 파일 머리(---·+++)는 첫 @@ 앞에만 있으니 덩어리 밖은 보지 않는다
# (`^\+[^+]`로 머리를 거르면 내용이 +로 시작하는 줄을 놓친다)
added="$(awk '/^diff --git /{hunk=0; next} /^@@/{hunk=1; next} hunk && /^\+/' "$patch")"
MODIFIERS='(skip|only|skipIf|runIf|todo|fails)'
if grep -qE "\b(it|test|describe|suite)(\.[A-Za-z]+)*\.${MODIFIERS}(\.[A-Za-z]+)*\s*\(" <<<"$added" ||
  grep -qE "^\+\s*\.${MODIFIERS}\b" <<<"$added" ||
  grep -qE '(^|[^A-Za-z0-9_$])skip\s*\(' <<<"$added"; then
  reasons+=("테스트를 끄거나 뒤집는 수식어·호출(skip·only·skipIf·runIf·todo·fails)")
fi
grep -qE '@ts-(ignore|nocheck|expect-error)' <<<"$added" && reasons+=("@ts-ignore·@ts-nocheck·@ts-expect-error")

if ((${#reasons[@]} == 0)) && ! git -c core.hooksPath=/dev/null apply --check -- "$patch" 2>/dev/null; then
  reasons+=("저장소에 적용되지 않는다")
fi

if ((${#reasons[@]} > 0)); then
  printf '거부: %s\n' "$(printf '%s\n' "${reasons[@]}" | sort -u | paste -sd ',' - | sed 's/,/, /g')"
  exit 1
fi
echo "통과: $(sed -n 's#^diff --git a/\(.*\) b/.*$#\1#p' "$patch" | sort -u | paste -sd ' ' -)"
