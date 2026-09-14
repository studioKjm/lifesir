// T-014 — 회원가입/로그인 (AC-001)
// T-006/T-007 (seed-v2, AC-005) — 세션 관리를 @supabase/ssr 표준으로 전환.
// Pair Mode(Navigator Plan A)로 설계됨 — 근거는 각 함수 주석 참고.
import { createAuthClient, createServerSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";
import { DuplicateEmailError } from "@/lib/data/errors";
import { getPersonaForBirthDate } from "@/services/agent-persona-service";
import type { AuthResult, SignInInput, SignUpInput, SupabaseCookieAdapter } from "@/types/dto";

export type AuthErrorCode =
  | "EMAIL_ALREADY_EXISTS"
  | "INVALID_CREDENTIALS"
  | "SIGNUP_FAILED"
  | "OAUTH_EXCHANGE_FAILED"
  | "OAUTH_EMAIL_NOT_VERIFIED";

export class AuthError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

function toSession(session: { access_token: string; refresh_token: string; expires_at?: number }) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? 0,
  };
}

/**
 * 회원가입 — seed ontology의 SignUp.side_effects("세션/토큰 발급")를 충족하기 위해
 * 가입 성공 직후 signInWithPassword로 세션까지 함께 발급한다 (decomposition T-019가
 * 기대하는 "회원가입 → 자동 로그인" 플로우).
 *
 * (seed-v2) 계정 생성(admin.createUser)은 여전히 service-role 전용 createAuthClient()로
 * 한다 — 자격증명 로직 자체는 안 바뀐다. 세션을 "확립"하는 마지막 단계만
 * createServerSupabaseClient(cookieAdapter)로 바꿔서, @supabase/ssr이 내부적으로
 * cookieAdapter.setAll()을 호출해 표준 형식의 세션 쿠키를 심게 한다.
 */
export async function signUp(input: SignUpInput, cookieAdapter: SupabaseCookieAdapter): Promise<AuthResult> {
  const adminClient = createAuthClient();

  const created = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? "";
    if (message.toLowerCase().includes("already") || message.toLowerCase().includes("exists")) {
      throw new AuthError("EMAIL_ALREADY_EXISTS", `이미 가입된 이메일입니다 (email=${input.email})`);
    }
    throw new AuthError("SIGNUP_FAILED", `회원가입에 실패했습니다: ${message}`);
  }
  const authUserId = created.data.user.id;

  // persona 매칭 실패는 가입 자체를 막지 않는다 (AC-010 정신 — 예외로 전체 플로우가 깨지지 않게).
  let agentPersonaId: string | null = null;
  try {
    const persona = await getPersonaForBirthDate(input.birthDate);
    agentPersonaId = persona?.id ?? null;
  } catch (err) {
    console.warn(`AgentPersona 매칭 실패 — agentPersonaId 없이 가입을 계속합니다 (userId=${authUserId})`, err);
  }

  try {
    await userRepository.createUser({
      id: authUserId,
      email: input.email,
      name: input.name,
      birthDate: input.birthDate,
      agentPersonaId,
    });
  } catch (err) {
    // public.users 생성 실패 → auth 계정을 롤백한다 (cascade로 부분 삽입분도 함께 정리됨).
    await adminClient.auth.admin.deleteUser(authUserId);
    throw new AuthError("SIGNUP_FAILED", `사용자 정보 저장에 실패해 가입을 롤백했습니다: ${(err as Error).message}`);
  }

  // 세션 확립 — anon key로 충분한 표준 작업이라 service role이 필요 없다.
  const signedIn = await createServerSupabaseClient(cookieAdapter).auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (signedIn.error || !signedIn.data.session) {
    throw new AuthError("SIGNUP_FAILED", `가입 후 자동 로그인에 실패했습니다: ${signedIn.error?.message}`);
  }

  return {
    user: { id: authUserId, email: input.email, name: input.name },
    session: toSession(signedIn.data.session),
  };
}

/**
 * (seed-v2, AC-005) src/proxy.ts는 세션 존재/유효성만 얕게 확인하는 UX 게이트다.
 * 실제 보안 경계는 여기다 — 각 페이지/Server Action이 요청 쿠키를 담은
 * cookieAdapter를 이 함수에 넘겨 신뢰 가능한 userId를 얻는다.
 *
 * 세션이 없거나 유효하지 않으면 null을 반환한다(예외를 던지지 않음 — 호출부가
 * 그대로 /login으로 리다이렉트하면 되는 정상 흐름이다).
 *
 * ⚠️ 이 함수 안에서 만든 클라이언트를 모듈 스코프 변수 등으로 캐싱하지 않는다.
 * 캐싱된 싱글턴에서 인증 메서드를 호출하면 세션이 프로세스 전역으로 유출되는
 * 버그가 실제로 발생한 적이 있다(2026-09-11, supabase-client.ts의 createAuthClient
 * 주석 참고) — createServerSupabaseClient()도 매 호출 로컬 변수로만 쓴다.
 */
export async function getSessionUser(cookieAdapter: SupabaseCookieAdapter): Promise<{
  id: string;
  email: string;
  name: string;
  // seed-v2, AC-004 — 온보딩 완료 여부를 페이지가 판단할 수 있도록 추가.
  agentPersonaId: string | null;
  birthDate: string | null;
} | null> {
  const supabase = createServerSupabaseClient(cookieAdapter);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const profile = await userRepository.getUserById(data.user.id);
  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    agentPersonaId: profile.agentPersonaId,
    birthDate: profile.birthDate,
  };
}

export async function signIn(input: SignInInput, cookieAdapter: SupabaseCookieAdapter): Promise<AuthResult> {
  const signedIn = await createServerSupabaseClient(cookieAdapter).auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    // 이메일 존재 여부를 노출하지 않도록 단일 에러 코드로 통일한다.
    throw new AuthError("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다");
  }

  const profile = await userRepository.getUserById(signedIn.data.user.id);
  if (!profile) {
    throw new AuthError("INVALID_CREDENTIALS", "사용자 정보를 찾을 수 없습니다");
  }

  return {
    user: { id: profile.id, email: profile.email, name: profile.name },
    session: toSession(signedIn.data.session),
  };
}

/**
 * (seed-v2, AC-004) 온보딩 완료 — 구글로 처음 로그인해 생년월일이 없던 유저가
 * 뒤늦게 입력한다. 온보딩 완료 여부의 기준은 birthDate가 아니라 agentPersonaId다
 * (Navigator Plan A) — persona 매칭 자체가 실패해도(사실상 DB 장애 수준의 사건,
 * 5개 age_band가 나이 구간을 빈틈없이 커버하고 시드 데이터도 항상 존재하므로
 * 정상 상황에선 실패하지 않는다) birthDate는 저장하고 넘어간다. signUp이 이미
 * 채택한 "persona 매칭 실패는 흐름을 막지 않는다"는 관용 정책과 동일하다 —
 * 이렇게 해야 매칭 실패로 agentPersonaId가 여전히 null인 유저가 배너를 통해
 * 계속 재시도할 길이 남는다(엄격하게 실패시켜 birthDate까지 버리면, "입력해도
 * 매칭 안 됨" 상태에서 재입력할 방법이 없어져 seed invariant를 어긴다).
 */
export async function completeOnboarding(
  userId: string,
  birthDate: string
): Promise<{ birthDate: string; agentPersonaId: string | null }> {
  let agentPersonaId: string | null = null;
  try {
    const persona = await getPersonaForBirthDate(birthDate);
    agentPersonaId = persona?.id ?? null;
  } catch (err) {
    console.warn(`AgentPersona 매칭 실패 — agentPersonaId 없이 온보딩을 계속합니다 (userId=${userId})`, err);
  }

  const updated = await userRepository.updateProfile(userId, { birthDate, agentPersonaId });
  return { birthDate: updated.birthDate as string, agentPersonaId: updated.agentPersonaId };
}

/**
 * (seed-v2, AC-001, AC-003) 구글 OAuth 콜백 처리.
 *
 * 동일 이메일 자동 연결은 Supabase Auth(GoTrue)가 exchangeCodeForSession() 안에서
 * 자체적으로 처리한다 — 우리는 "연결하라"는 API를 따로 부르지 않는다. 문제는
 * GoTrue가 연결에 실패해도(예: 이메일 미인증) 에러를 던지지 않고 조용히 별개의
 * auth.users 행을 만들어버린다는 점이다(Supabase 공식 문서에 그런 에러가
 * 문서화돼 있지 않음, 2026-09-13 리서치로 확인). 우리가 감지할 수 있는 유일한
 * 신호는 public.users.email UNIQUE 제약 위반뿐이라, getUserByEmail로 명시적
 * 사전 비교까지 해서 이중으로 확인한다(Navigator Plan C).
 *
 * ⚠️ exchangeCodeForSession()은 성공하는 즉시 cookieAdapter.setAll()을 통해
 * 세션 쿠키를 응답에 심어버린다 — 그 뒤에 연결 거부를 판정해도 이미 쿠키는
 * 심긴 상태다. 그래서 거부 시 반드시 (1) 방금 생성된 auth.users를 admin으로
 * 삭제하고 (2) 같은 cookieAdapter로 signOut()까지 명시적으로 호출해 브라우저에
 * 남은 세션을 서버 레벨에서 무효화한다(Navigator 리뷰로 발견 — admin.deleteUser
 * 만으로는 이미 발급된 JWT 자체가 만료 전까지 유효하게 남는다).
 */
export async function exchangeGoogleSession(code: string, cookieAdapter: SupabaseCookieAdapter): Promise<AuthResult> {
  const supabase = createServerSupabaseClient(cookieAdapter);
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.session || !exchanged.data.user) {
    throw new AuthError("OAUTH_EXCHANGE_FAILED", `구글 로그인 세션 교환에 실패했습니다: ${exchanged.error?.message}`);
  }

  const authUser = exchanged.data.user;
  const email = authUser.email;
  if (!email) {
    await rejectGoogleSession(authUser.id, cookieAdapter);
    throw new AuthError("OAUTH_EMAIL_NOT_VERIFIED", "구글 계정에서 이메일 정보를 가져올 수 없습니다");
  }

  // 이미 존재하는 유저 — 재로그인이거나, GoTrue가 정상적으로 자동연결한 경우.
  const existingById = await userRepository.getUserById(authUser.id);
  if (existingById) {
    return {
      user: { id: existingById.id, email: existingById.email, name: existingById.name },
      session: toSession(exchanged.data.session),
    };
  }

  // 명시적 사전 비교 — 자동연결이 안 됐는데 이메일은 이미 다른 유저가 쓰고 있다면 거부.
  const existingByEmail = await userRepository.getUserByEmail(email);
  if (existingByEmail && existingByEmail.id !== authUser.id) {
    await rejectGoogleSession(authUser.id, cookieAdapter);
    throw new AuthError(
      "OAUTH_EMAIL_NOT_VERIFIED",
      "이 구글 계정의 이메일이 인증되지 않아 기존 계정과 연결할 수 없습니다"
    );
  }

  // 완전 신규 — 구글 프로필에서 표시 이름을 뽑는다(둘 다 없으면 이메일 아이디 부분으로 대체).
  const metadata = authUser.user_metadata as { full_name?: string; name?: string } | undefined;
  const name = metadata?.full_name ?? metadata?.name ?? email.split("@")[0];

  try {
    const created = await userRepository.createUser({ id: authUser.id, email, name, agentPersonaId: null });
    return {
      user: { id: created.id, email: created.email, name: created.name },
      session: toSession(exchanged.data.session),
    };
  } catch (err) {
    // DuplicateEmailError뿐 아니라 그 외 저장 실패도 orphan 계정을 남기지 않는다.
    await rejectGoogleSession(authUser.id, cookieAdapter);
    if (err instanceof DuplicateEmailError) {
      throw new AuthError(
        "OAUTH_EMAIL_NOT_VERIFIED",
        "이 구글 계정의 이메일이 인증되지 않아 기존 계정과 연결할 수 없습니다"
      );
    }
    throw new AuthError("SIGNUP_FAILED", `구글 계정 정보를 저장하지 못했습니다: ${(err as Error).message}`);
  }
}

/** exchangeGoogleSession의 거부 분기 공통 처리 — orphan auth.users 삭제 + 브라우저 세션 무효화. */
async function rejectGoogleSession(authUserId: string, cookieAdapter: SupabaseCookieAdapter): Promise<void> {
  await createAuthClient().auth.admin.deleteUser(authUserId);
  await createServerSupabaseClient(cookieAdapter).auth.signOut();
}

/**
 * (seed-v2, AC-006) 로그아웃 — 쿠키만 지우는 게 아니라 서버 측에서 refresh
 * token 자체를 무효화한다(signOut). 이메일/구글 로그인 사용자 모두 동일하게
 * 동작한다 — 세션이 어떻게 만들어졌는지와 무관하게 같은 쿠키/세션 모델을 쓰기 때문.
 */
export async function signOut(cookieAdapter: SupabaseCookieAdapter): Promise<void> {
  await createServerSupabaseClient(cookieAdapter).auth.signOut();
}
