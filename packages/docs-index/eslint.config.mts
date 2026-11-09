import { base, layers } from '@app/eslint-config';
import { defineConfig } from 'eslint/config';

// 저장소 문서 도구 — 파일 시스템을 읽고 쓰는 Node 전용 코드다.
export default defineConfig([
  base,
  layers(import.meta.dirname, [
    { type: 'docs-index', pattern: 'src', externals: ['zod'], core: true },
  ]),
]);
