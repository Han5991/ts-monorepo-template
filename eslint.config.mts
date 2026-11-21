import { base } from '@app/eslint-config';

/**
 * 루트 자신의 파일(설정 파일·scripts/)과, 자기 설정 파일이 없는 packages/eslint-config에 적용된다. 공통 규칙은
 * @app/eslint-config에 있고, 나머지 앱·패키지는 자기 경로의 eslint.config.mts에서 그것을 상속한다.
 */
export default base;
