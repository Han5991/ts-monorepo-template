import { describe, expect, it } from 'vitest';
import { syncRenovate } from '#/gates.ts';
import { readGates, readJson, RENOVATE_FILE } from '#/repo.ts';

describe('저장소의 업그레이드 관문', () => {
  it('upgrade-gates.json 형식이 맞다', () => {
    expect(() => readGates()).not.toThrow();
  });

  it('renovate.json의 관문 규칙이 upgrade-gates.json과 일치한다 — 어긋나면 `pnpm gates sync`', () => {
    const renovate = readJson(RENOVATE_FILE);
    expect(renovate).toEqual(syncRenovate(renovate, readGates()));
  });
});
