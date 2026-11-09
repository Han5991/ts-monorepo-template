import { describe, expect, it } from 'vitest';
import { readEnv } from '#/main/env.ts';

describe('readEnv', () => {
  it('PORT가 없으면 8787, 있으면 그 값', () => {
    expect(readEnv({})).toEqual({ port: 8787 });
    expect(readEnv({ PORT: '3000' })).toEqual({ port: 3000 });
  });

  it('숫자가 아니거나 범위 밖이면 시작하지 않는다', () => {
    for (const PORT of ['abc', '0', '70000']) {
      expect(() => readEnv({ PORT })).toThrow('PORT');
    }
  });
});
