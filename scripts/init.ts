import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// pnpm init:project <이름>
// 템플릿의 자리표시자 — 패키지 스코프 `@app/`과 저장소 이름 — 를 이 프로젝트 이름으로 바꾼다.
// git이 추적하는 텍스트 파일만 고친다(lockfile 포함 — 그래서 바로 `pnpm install`이 된다).
const ROOT = path.resolve(import.meta.dirname, '..');
const SELF = 'scripts/init.ts';
const PLACEHOLDER_SCOPE = '@app/';
const PLACEHOLDER_NAME = 'ts-monorepo-template';
const TEXT_FILE = /\.(json|ya?ml|ts|tsx|mts|md)$/;
// 외부에서 가져온 스킬은 출처 판 그대로 둔다
const UNTOUCHED = ['.claude/skills/'];

const name = process.argv[2];
if (name === undefined || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(
    '사용: pnpm init:project <이름> — 소문자로 시작하고 소문자·숫자·-만',
  );
  process.exit(1);
}

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(
    f =>
      TEXT_FILE.test(f) &&
      f !== SELF &&
      !UNTOUCHED.some(prefix => f.startsWith(prefix)) &&
      // CLAUDE.md는 AGENTS.md를 가리키는 링크다 — 원본만 고친다
      !lstatSync(path.join(ROOT, f)).isSymbolicLink(),
  );

const changed: string[] = [];
for (const file of files) {
  const full = path.join(ROOT, file);
  const before = readFileSync(full, 'utf8');
  const after = before
    .replaceAll(PLACEHOLDER_SCOPE, `@${name}/`)
    .replaceAll(PLACEHOLDER_NAME, name);
  if (after !== before) {
    writeFileSync(full, after);
    changed.push(file);
  }
}

console.log(
  `@app/ → @${name}/, ${PLACEHOLDER_NAME} → ${name}: 파일 ${String(changed.length)}개를 고쳤다`,
);
console.log(
  '다음: pnpm install → pnpm turbo run lint check-types test → README.md·AGENTS.md의 "목적"을 채운다',
);
