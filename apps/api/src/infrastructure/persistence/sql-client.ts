export type SqlParam = string | number | null;

/** DB가 돌려주는 행은 바깥 입력이다 — 쓰는 쪽이 zod로 좁힌다 */
export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlStatement {
  /** 매개변수는 $1, $2 … (Postgres 표기). SQLite 계열 어댑터가 ?1, ?2 …로 바꾼다 */
  text: string;
  params?: SqlParam[];
}

/**
 * DB 접근면. SQL은 SQLite와 Postgres 양쪽에서 도는 공통 부분만 쓴다 — 저장소 테스트가 두 방언에서 같이 돈다.
 * 트랜잭션은 "문장 묶음을 원자적으로 실행"으로만 노출한다(대화형 트랜잭션이 없는 DB(D1 등)도 있어서 batch만 약속한다).
 */
export interface SqlClient {
  query(text: string, params?: SqlParam[]): Promise<SqlRow[]>;
  /** 모두 성공하거나 모두 취소된다. 결과는 돌려주지 않는다 */
  batch(statements: SqlStatement[]): Promise<void>;
}
