export class RepositoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepositoryError";
  }
}

/**
 * (seed-v2, AC-003) users.email의 UNIQUE 제약(Postgres code 23505) 위반을
 * 구분해서 던진다 — Logic 레이어가 "구글 계정 자동연결 실패"를 감지하는 유일한
 * 신호다(Supabase Auth가 자동연결 실패를 명시적 에러로 알려주지 않기 때문).
 */
export class DuplicateEmailError extends RepositoryError {
  email: string;
  constructor(email: string, options?: { cause?: unknown }) {
    super(`이메일이 이미 사용 중입니다 (email=${email})`, options);
    this.name = "DuplicateEmailError";
    this.email = email;
  }
}
