import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GatesFileSchema, type GatesFile } from '#/gates.ts';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
/** 관문의 단일 출처 */
export const GATES_FILE = 'upgrade-gates.json';
/** 관문 규칙이 생성되어 들어가는 곳 */
export const RENOVATE_FILE = 'renovate.json';

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(
    path.join(REPO_ROOT, file),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export function readGates(): GatesFile {
  return GatesFileSchema.parse(readJson(GATES_FILE));
}
