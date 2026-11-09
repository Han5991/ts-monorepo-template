import { base, layers, noNodeBuiltins, TEST_FILES } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 범용 fetch 래퍼 — 우리 도메인·계약을 모른다. 브라우저·서버 어디서나 돈다.
export default defineConfig([
  base,
  { files: ['src/**/*.ts'], ignores: TEST_FILES, rules: noNodeBuiltins },
  layers(import.meta.dirname, [
    { type: 'http-client', pattern: 'src', externals: ['zod'] },
  ]),
]);
