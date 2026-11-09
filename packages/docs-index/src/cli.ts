import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ADR_DIR,
  AGENTS_FILE,
  agentsIndex,
  REPO_ROOT,
  trackedFiles,
} from '#/repo.ts';

const { current, expected } = agentsIndex(
  REPO_ROOT,
  trackedFiles(REPO_ROOT, ADR_DIR),
);
if (current === expected) {
  console.log(`${AGENTS_FILE} 결정 색인: 변경 없음`);
} else {
  writeFileSync(path.join(REPO_ROOT, AGENTS_FILE), expected);
  console.log(`${AGENTS_FILE} 결정 색인을 갱신했다`);
}
