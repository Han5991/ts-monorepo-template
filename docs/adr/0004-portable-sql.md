---
date: 2026-11-09
status: accepted
---

# DB는 SqlClient 포트 뒤에, SQL은 SQLite·Postgres 공통 부분만

## 결정

- 저장소 구현은 `SqlClient` 접근면(`query`·`batch`) 뒤에 있다. SQL은 SQLite·Postgres 공통 부분만 쓴다(매개변수 `$1` 표기).
- 트랜잭션은 "문장 묶음을 원자적으로"(`batch`)로만 쓴다 — 대화형 트랜잭션이 없는 DB도 있다.
- 마이그레이션 실행기는 자체 구현이다(벤더 CLI의 마이그레이션 기능을 쓰지 않는다) — DB를 옮겨도 기록 방식이 같다.
- 저장소·마이그레이션 테스트는 PGlite(프로세스 안 Postgres)에서 돈다. 실제로 쓸 DB를 정하면 그 어댑터를
  `src/test/sql-backends.ts`에 더해 같은 테스트를 그 위에서도 돌린다.
- 개발 서버는 메모리 저장소로 시작한다. DB를 고르면 `main`에서 어댑터만 바꾼다.

## 이유

DB 선택은 프로젝트마다 다르다. 바꾸는 곳이 어댑터 하나와 조립 지점뿐이어야 옮기는 위험이 작다.
