import { base, layers } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 저장소 도구 — 파일 시스템·레지스트리를 읽는 Node 전용 코드다.
export default defineConfig([
  base,
  layers(import.meta.dirname, [
    {
      type: 'upgrade-gates',
      pattern: 'src',
      externals: ['zod', 'semver'],
      core: true,
    },
  ]),
]);
