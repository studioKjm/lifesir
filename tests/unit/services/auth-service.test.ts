import { describe, expect, it, vi, beforeEach } from "vitest";
import { signUp, signIn, AuthError } from "@/services/auth-service";
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";
import * as agentPersonaService from "@/services/agent-persona-service";
import type { UserRecord } from "@/lib/data/records";

vi.mock("@/lib/data/supabase-client");
vi.mock("@/lib/data/user-repository");
vi.mock("@/services/agent-persona-service");

const mockCreateUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockSignInWithPassword = vi.fn();

function mockSupabase() {
  return {
    auth: {
      admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser },
      signInWithPassword: mockSignInWithPassword,
    },
  };
}

const SESSION = {
  access_token: "at",
  refresh_token: "rt",
  expires_at: 123,
  user: { id: "auth-user-1" },
};

function user(overrides: Partial<UserRecord>): UserRecord {
  return {
    id: "auth-user-1",
    email: "a@test.local",
    name: "테스트",
    birthDate: "1990-01-01",
    agentPersonaId: "p1",
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

describe("signUp (AC-001)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue(mockSupabase() as never);
  });

  it("성공: 계정 생성 + persona 매칭 + 자동 로그인 세션 반환", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockResolvedValue({
      id: "p1",
      ageBand: "30s",
      tone: "t",
      systemPrompt: "s",
    });
    vi.mocked(userRepository.createUser).mockResolvedValue(user({}));
    mockSignInWithPassword.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });

    const result = await signUp({ email: "a@test.local", password: "pw", name: "테스트", birthDate: "1990-01-01" });

    expect(result.session.accessToken).toBe("at");
    expect(result.user.id).toBe("auth-user-1");
    expect(userRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ agentPersonaId: "p1", id: "auth-user-1" })
    );
  });

  it("EMAIL_ALREADY_EXISTS: 중복 이메일", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: null }, error: { message: "User already registered" } });

    await expect(
      signUp({ email: "dup@test.local", password: "pw", name: "n", birthDate: "1990-01-01" })
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_EXISTS" });
  });

  it("persona 매칭 실패해도 가입은 성공한다 (agentPersonaId=null)", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockRejectedValue(new Error("repo down"));
    vi.mocked(userRepository.createUser).mockResolvedValue(user({ agentPersonaId: null }));
    mockSignInWithPassword.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });

    const result = await signUp({ email: "a@test.local", password: "pw", name: "테스트", birthDate: "1990-01-01" });

    expect(result.user.id).toBe("auth-user-1");
    expect(userRepository.createUser).toHaveBeenCalledWith(expect.objectContaining({ agentPersonaId: null }));
  });

  it("user-repository 실패 시 auth 계정을 롤백한다 (deleteUser 호출)", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockResolvedValue(null);
    vi.mocked(userRepository.createUser).mockRejectedValue(new Error("db down"));

    await expect(
      signUp({ email: "a@test.local", password: "pw", name: "테스트", birthDate: "1990-01-01" })
    ).rejects.toMatchObject({ code: "SIGNUP_FAILED" });

    expect(mockDeleteUser).toHaveBeenCalledWith("auth-user-1");
  });
});

describe("signIn (AC-001)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue(mockSupabase() as never);
  });

  it("성공: 세션 + 프로필 정보 반환", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });
    vi.mocked(userRepository.getUserById).mockResolvedValue(user({}));

    const result = await signIn({ email: "a@test.local", password: "pw" });

    expect(result.user.email).toBe("a@test.local");
    expect(result.session.accessToken).toBe("at");
  });

  it("INVALID_CREDENTIALS: 잘못된 비밀번호", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: { message: "invalid" } });

    await expect(signIn({ email: "a@test.local", password: "wrong" })).rejects.toThrow(AuthError);
  });
});
