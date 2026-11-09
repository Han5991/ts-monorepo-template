import { base, layers, noNodeBuiltins, TEST_FILES } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 우리 API 클라이언트 — 계약과 공통 fetch 클라이언트만 안다. 브라우저·서버 어디서나 돈다.
export default defineConfig([
  base,
  { files: ['src/**/*.ts'], ignores: TEST_FILES, rules: noNodeBuiltins },
  layers(import.meta.dirname, [
    {
      type: 'api-client',
      pattern: 'src',
      packages: ['contracts', 'http-client'],
    },
  ]),
]);
