import { base } from '@app/eslint-config';

/**
 * 루트 자신의 파일(설정 파일·scripts/)에만 적용된다. 공통 규칙은 @app/eslint-config에 있고,
 * 각 앱·패키지는 자기 경로의 eslint.config.mts에서 그것을 상속한다.
 */
export default base;
