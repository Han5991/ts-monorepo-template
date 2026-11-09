import tasks from '#/infrastructure/persistence/migrations/0001-tasks.ts';

export interface Migration {
  name: string;
  /** 문장 하나씩. 한 마이그레이션은 기록과 함께 원자적으로 적용된다 */
  statements: readonly string[];
}

// 적용 순서의 단일 출처. 한 번 배포된 항목은 고치지 않고 새 항목을 뒤에 붙인다.
export const MIGRATIONS: readonly Migration[] = [
  { name: '0001-tasks', statements: tasks },
];
