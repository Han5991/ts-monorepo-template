import { base, layers, TEST_FILES } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// CI 자동 수정 패치를 테스트 결과로 검사하는 Node 도구. verify 잡이 기본 브랜치의 판을 작업 트리 밖에 복사해 쓰므로 그 자리에는
// node_modules가 없다 — 실행할 때 쓰는 것은 Node 코어 모듈뿐이고, vitest는 보고서 API의 타입만 가져온다.
export default defineConfig([
  base,
  {
    files: ['src/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vitest', 'vitest/*'],
              allowTypeImports: true,
              message:
                '실행할 때는 vitest를 가져오지 않는다 — verify 잡은 이 패키지를 node_modules 없는 곳에 복사해 쓴다. 타입만(import type) 가져온다.',
            },
          ],
        },
      ],
    },
  },
  layers(import.meta.dirname, [
    {
      type: 'ci-fix-guard',
      pattern: 'src',
      // 보고서 API의 타입만(값으로 가져오는 것은 위 규칙이 막는다)
      externals: ['vitest'],
      core: true,
    },
  ]),
]);
