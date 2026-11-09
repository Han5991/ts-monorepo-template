import { base, layers, noNodeBuiltins, TEST_FILES } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 클린 아키텍처: 의존은 바깥 → 안쪽으로만. main(조립)만 전부를 알고, 프레임워크·드라이버는 바깥 레이어에만 둔다.
export default defineConfig([
  base,
  { files: ['src/**/*.ts'], ignores: TEST_FILES, rules: noNodeBuiltins },
  layers(import.meta.dirname, [
    // 유스케이스 + 포트. 도메인만 안다 — 프레임워크·DB·HTTP를 모른다
    { type: 'application', pattern: 'src/application', packages: ['domain'] },
    // 포트 구현(어댑터)
    {
      type: 'infrastructure',
      pattern: 'src/infrastructure',
      allow: ['application'],
      packages: ['domain'],
      // 행 검증용 zod만. DB 드라이버·업체 SDK는 조립 지점(main)이 넘긴다
      externals: ['zod'],
    },
    // HTTP 라우트: 유스케이스를 부르고 domain → contracts로 매핑한다
    {
      type: 'interface',
      pattern: 'src/interface',
      allow: ['application'],
      packages: ['domain', 'contracts'],
      externals: ['hono', 'hono/*'],
    },
    // 조립(composition root) — 실행 환경(포트·DB 선택)을 아는 유일한 곳
    {
      type: 'main',
      pattern: 'src/main',
      allow: ['application', 'infrastructure', 'interface'],
      packages: ['domain'],
      // 서버 어댑터 + 환경 변수(바깥 입력) 검증
      externals: ['@hono/node-server', 'zod'],
    },
    // 테스트 헬퍼 — 테스트만 import할 수 있다
    {
      type: 'test-support',
      pattern: 'src/test',
      allow: ['application', 'infrastructure'],
      packages: ['domain'],
      // pglite: Postgres 방언을 프로세스 안에서 돌린다
      externals: ['@electric-sql/pglite'],
      core: true,
    },
  ]),
]);
