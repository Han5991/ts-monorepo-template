import {
  base,
  domainLayers,
  noNodeBuiltins,
  noTopLevelEffects,
  TEST_FILES,
} from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 도메인 = 가장 안쪽. 다른 워크스페이스 패키지·프레임워크·I/O를 모른다.
// 외부 의존은 zod 하나만 허용한다 — 엔티티 검증의 단일 출처이고 I/O가 아니다(손으로 짠 검증기를 또 두지 않으려고).
export default defineConfig([
  base,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      ...noNodeBuiltins,
      // 불러오기만 해서 일어나는 일이 없다(ADR 0011, package.json의 sideEffects: false)
      ...noTopLevelEffects,
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: '도메인은 I/O를 하지 않는다.' },
      ],
    },
  },
  // 명사마다 모듈 하나(ADR 0010). 다른 모듈과 배럴은 그 모듈의 index.ts로만 들어온다 — 모듈 안쪽을 바꿔도 밖이 흔들리지 않게.
  // 모듈끼리의 방향은 `allow`에 적는다. src 아래 폴더가 이 목록과 다르면 lint가 시작하지 않는다.
  domainLayers(import.meta.dirname, [{ type: 'task', externals: ['zod'] }]),
]);
