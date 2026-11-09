import { base, layers, noNodeBuiltins, TEST_FILES } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 도메인 = 가장 안쪽. 다른 워크스페이스 패키지·프레임워크·I/O를 모른다.
// 외부 의존은 zod 하나만 허용한다 — 엔티티 검증의 단일 출처이고 I/O가 아니다(손으로 짠 검증기를 또 두지 않으려고).
export default defineConfig([
  base,
  {
    files: ['src/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      ...noNodeBuiltins,
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: '도메인은 I/O를 하지 않는다.' },
      ],
    },
  },
  // 도메인 모듈마다 element 하나. 다른 모듈은 entry(index.ts)로만 들어온다 — 모듈 안쪽을 바꿔도 밖이 흔들리지 않게
  layers(import.meta.dirname, [
    {
      type: 'task',
      pattern: 'src/task',
      externals: ['zod'],
      entry: 'index.ts',
    },
    { type: 'barrel', pattern: 'src', allow: ['task'] },
  ]),
]);
