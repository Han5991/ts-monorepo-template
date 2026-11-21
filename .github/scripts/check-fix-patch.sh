#!/usr/bin/env bash
# Claude가 낸 수정 패치를 LLM 없이 검사한다. 통과하면 0, 거부하면 이유를 찍고 1.
# 현재 디렉터리는 패치를 적용할 저장소(실패한 커밋으로 checkout된 상태)여야 한다.
#
# 받는 것(허용 목록 — ALLOWED): 이미 git이 추적하는 텍스트 파일 가운데 앱·패키지의 src(소스·테스트), 루트 scripts, 루트
# README.md의 수정만. 목록 밖은 모두 거부한다 — 설정(package.json·lockfile·tsconfig·eslint·turbo·prettier 등), 공통 lint
# 규칙(packages/eslint-config), CI·도구(.github·.claude·lefthook·renovate), 에이전트가 따르는 규칙(AGENTS.md와 docs/adr의 결정
# 기록 — 자동 수정 프롬프트가 "이 지시보다 우선한다"며 읽는다). 규칙을 풀어 CI를 초록으로 만드는 길을 막고, 새로 생기는
# 설정 파일도 목록에 없으니 그대로 막힌다. 설정·규칙을 꼭 바꿔야 하는 실패는 사람이 고친다(멘션이 간다).
# 경로를 읽을 수 없는 머리(ASCII 밖의 문자가 들어 git이 따옴표로 감싼 경로)도 거부한다 — 읽지 못한 경로가 검사를 건너뛰지 않게.
# 그 밖에 거부하는 것:
#   - 새 파일·삭제·이름 바꾸기·모드 변경·심볼릭 링크(대상 바꾸기 포함)·바이너리
#   - 테스트를 끄거나 뒤집는 것(skip·only·skipIf·runIf·todo·fails):
#     - 수식어 — it·test·describe와 그 별칭 suite에. 이어 붙이거나(.concurrent.skip·.skip.each) 줄을 나눠 붙이거나,
#       선택적 체이닝으로 붙이거나(it?.only), 부르지 않고 참조만 해도(const s = it.skip), 대괄호로 꺼내도(it["only"])
#     - 실행 중에 건너뛰는 skip() 호출(ctx.skip()·ctx.skip?.()·구조 분해한 skip()). 다른 객체의 .skip() 호출도 보수적으로
#     - 테스트 옵션 객체의 키({ skip: true }). 값이 숫자·문자열이면 통과한다 — 옵션 값으로는 타입 오류라 테스트를 끌 수 없고,
#       예시 도메인의 { todo: 0 } 같은 상태별 값이 걸리지 않게
#     - 수식어 이름의 변수 선언(const skip = …)과 단축 속성({ skip }) — 옵션 객체에 값을 넘기는 다른 꼴
#     같은 이름의 식별자·타입도 보수적으로 거부한다(const todo = …, { todo }, todo: TaskStatus) — 예시 도메인의 todo 상태를
#     건드리는 수정 일부가 자동으로 고쳐지지 않고 사람에게 간다
#     이 검사는 흔한 꼴을 거르는 문자열 검사다 — 코드의 뜻을 보지 않으니 다 막지는 못한다. 못 보는 것: test.extend로 만든
#     다른 이름(myTest.todo), 다른 파일에서 만든 옵션 객체를 넘기기, 허용 목록 안의 검사 도구 코드(docs-index·upgrade-gates의
#     src)나 테스트 도우미(돌릴 대상 목록 등)를 느슨하게 고치기, 단언을 실패에 맞춰 바꾸기 — 프롬프트 규칙과 리뷰가 본다
#   - 타입 검사를 끄는 주석(@ts-ignore·@ts-nocheck·@ts-expect-error — 설명을 붙여도)
#   - 저장소에 적용되지 않는 패치
#
# 회귀 테스트: bash .github/scripts/check-fix-patch.test.sh (CI의 quality-checks가 돌린다)
set -euo pipefail
export LC_ALL=C.UTF-8

patch="${1:?사용: check-fix-patch.sh <패치 파일>}"
[[ -s "$patch" ]] || { echo "거부: 패치가 비었다"; exit 1; }

ALLOWED='^((apps|packages)/[^/]+/src/|scripts/|README\.md$)'

reasons=()
while IFS= read -r line; do
  case "$line" in
    'new file mode '*) reasons+=("새 파일") ;;
    'deleted file mode '*) reasons+=("파일 삭제") ;;
    'rename from '* | 'copy from '*) reasons+=("이름 바꾸기·복사") ;;
    'old mode '* | 'new mode '*) reasons+=("모드 변경") ;;
    'GIT binary patch' | 'Binary files '*) reasons+=("바이너리") ;;
    # 경로에 ASCII 밖의 문자가 있으면 git이 "a/…" "b/…"로 감싼다 — 아래 경로 추출이 읽지 못하므로 여기서 거부한다
    'diff --git '*'"'*) reasons+=("따옴표로 감싼 경로(ASCII 밖의 문자)") ;;
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
if grep -qE "\b(it|test|describe|suite)(\??\.[A-Za-z]+)*\??\.${MODIFIERS}\b" <<<"$added" ||
  grep -qE "^\+\s*\.${MODIFIERS}\b" <<<"$added" ||
  grep -qE "\[\s*['\"\`]${MODIFIERS}['\"\`]\s*\]" <<<"$added" ||
  grep -qE '(^|[^A-Za-z0-9_$])skip\s*(\?\.\s*)?\(' <<<"$added" ||
  grep -qE "\b(skip|only|todo|fails)\s*:(\s*\$|\s*[^0-9'\"\`[:space:]])" <<<"$added" ||
  grep -qE "\b(const|let|var)\s+${MODIFIERS}\b" <<<"$added" ||
  grep -qE "([{,]|^\+)\s*${MODIFIERS}\s*([,}]|\$)" <<<"$added"; then
  reasons+=("테스트를 끄거나 뒤집는 수식어·호출·옵션(skip·only·skipIf·runIf·todo·fails)")
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
