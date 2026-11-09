#!/usr/bin/env bash
# Claude가 낸 수정 패치를 LLM 없이 검사한다. 통과하면 0, 거부하면 이유를 찍고 1.
# 현재 디렉터리는 패치를 적용할 저장소(실패한 커밋으로 checkout된 상태)여야 한다.
#
# 받는 것: 이미 git이 추적하는 텍스트 파일의 수정만.
# 거부하는 것:
#   - 새 파일·삭제·이름 바꾸기·모드 변경·심볼릭 링크·바이너리
#   - 의존성·도구·CI 설정(package.json·lockfile·pnpm-workspace.yaml·.npmrc·.tool-versions·lefthook·.github·.claude·renovate)
#     — CI를 고치는 데 필요 없고, 바꾸면 이후 잡이 실행할 코드가 달라진다
#   - 테스트를 끄는 흔적(.skip·.only)과 타입 검사를 끄는 주석(@ts-ignore·@ts-nocheck)
#   - 저장소에 적용되지 않는 패치
#
# 회귀 테스트: bash .github/scripts/check-fix-patch.test.sh (CI의 quality-checks가 돌린다)
set -euo pipefail
export LC_ALL=C.UTF-8

patch="${1:?사용: check-fix-patch.sh <패치 파일>}"
[[ -s "$patch" ]] || { echo "거부: 패치가 비었다"; exit 1; }

DENIED='^(\.github/|\.claude/|\.husky/|lefthook\.yml$|\.npmrc$|\.tool-versions$|pnpm-workspace\.yaml$|pnpm-lock\.yaml$|renovate\.json$|(.*/)?package\.json$)'

reasons=()
while IFS= read -r line; do
  case "$line" in
    'new file mode '*) reasons+=("새 파일") ;;
    'deleted file mode '*) reasons+=("파일 삭제") ;;
    'rename from '* | 'copy from '*) reasons+=("이름 바꾸기·복사") ;;
    'old mode '* | 'new mode '*) reasons+=("모드 변경") ;;
    'GIT binary patch' | 'Binary files '*) reasons+=("바이너리") ;;
  esac
done <"$patch"

while IFS= read -r path; do
  [[ "$path" =~ $DENIED ]] && reasons+=("허용하지 않는 경로: $path")
done < <(sed -n 's#^diff --git a/\(.*\) b/.*$#\1#p' "$patch" | sort -u)

added="$(grep -E '^\+[^+]' "$patch" || true)"
grep -qE '\b(it|test|describe)\.(skip|only)\(' <<<"$added" && reasons+=("테스트 skip·only")
grep -qE '@ts-(ignore|nocheck)' <<<"$added" && reasons+=("@ts-ignore·@ts-nocheck")

if ((${#reasons[@]} == 0)) && ! git -c core.hooksPath=/dev/null apply --check -- "$patch" 2>/dev/null; then
  reasons+=("저장소에 적용되지 않는다")
fi

if ((${#reasons[@]} > 0)); then
  printf '거부: %s\n' "$(printf '%s\n' "${reasons[@]}" | sort -u | paste -sd ',' - | sed 's/,/, /g')"
  exit 1
fi
echo "통과: $(sed -n 's#^diff --git a/\(.*\) b/.*$#\1#p' "$patch" | sort -u | paste -sd ' ' -)"
