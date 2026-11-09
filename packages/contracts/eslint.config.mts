import { base, layers, noNodeBuiltins, TEST_FILES } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// API 계약 = 인터페이스 레이어의 공용 부분. 도메인(상수 파생용)과 zod만 안다. 브라우저·서버 어디서나 돈다.
export default defineConfig([
  base,
  { files: ['src/**/*.ts'], ignores: TEST_FILES, rules: noNodeBuiltins },
  layers(import.meta.dirname, [
    {
      type: 'contracts',
      pattern: 'src',
      packages: ['domain'],
      externals: ['zod'],
    },
  ]),
]);
