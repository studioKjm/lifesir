// T-014 — 회원가입/로그인 (AC-001)
// Pair Mode(Navigator Plan A)로 설계됨 — 근거는 각 함수 주석 참고.
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";
import { getPersonaForBirthDate } from "@/services/agent-persona-service";
import type { AuthResult, SignInInput, SignUpInput } from "@/types/dto";

export type AuthErrorCode = "EMAIL_ALREADY_EXISTS" | "INVALID_CREDENTIALS" | "SIGNUP_FAILED";

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
 */
export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const supabase = getSupabaseClient();

  const created = await supabase.auth.admin.createUser({
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
    await supabase.auth.admin.deleteUser(authUserId);
    throw new AuthError("SIGNUP_FAILED", `사용자 정보 저장에 실패해 가입을 롤백했습니다: ${(err as Error).message}`);
  }

  const signedIn = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (signedIn.error || !signedIn.data.session) {
    throw new AuthError("SIGNUP_FAILED", `가입 후 자동 로그인에 실패했습니다: ${signedIn.error?.message}`);
  }

  return {
    user: { id: authUserId, email: input.email, name: input.name },
    session: toSession(signedIn.data.session),
  };
}

export async function signIn(input: SignInInput): Promise<AuthResult> {
  const supabase = getSupabaseClient();

  const signedIn = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
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
