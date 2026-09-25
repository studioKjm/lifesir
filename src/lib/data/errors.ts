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

/**
 * (seed-v3, AC-003) payment_methods.user_id의 UNIQUE 제약(Postgres 23505) 위반을
 * 구분해서 던진다 — "무료체험은 User당 평생 1회"라는 불변식의 최종 방어선이다.
 * Logic 레이어가 사전 확인(findByUserId)을 하더라도 동시 요청(TOCTOU)이 이 제약을
 * 뚫으려 시도할 수 있는데, 그걸 여기서 감지해 정상적인 도메인 에러로 변환한다.
 */
export class DuplicatePaymentMethodError extends RepositoryError {
  userId: string;
  constructor(userId: string, options?: { cause?: unknown }) {
    super(`이미 결제수단이 등록된 사용자입니다 (userId=${userId})`, options);
    this.name = "DuplicatePaymentMethodError";
    this.userId = userId;
  }
}
