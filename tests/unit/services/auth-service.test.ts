import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  signUp,
  signIn,
  signOut,
  getSessionUser,
  exchangeGoogleSession,
  completeOnboarding,
  AuthError,
} from "@/services/auth-service";
import { createAuthClient, createServerSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";
import { DuplicateEmailError } from "@/lib/data/errors";
import * as agentPersonaService from "@/services/agent-persona-service";
import type { UserRecord } from "@/lib/data/records";
import type { SupabaseCookieAdapter } from "@/types/dto";

vi.mock("@/lib/data/supabase-client");
vi.mock("@/lib/data/user-repository");
vi.mock("@/services/agent-persona-service");

const mockCreateUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockExchangeCodeForSession = vi.fn();

function mockAdminSupabase() {
  return { auth: { admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser } } };
}

function mockServerSupabase() {
  return {
    auth: {
      signInWithPassword: mockSignInWithPassword,
      getUser: mockGetUser,
      signOut: mockSignOut,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  };
}

// 실제 쿠키 접근은 안 하므로(어차피 mock되는 createServerSupabaseClient로만 전달됨)
// auth-service 입장에선 불투명한 토큰 역할만 하면 된다.
const FAKE_COOKIE_ADAPTER = {} as SupabaseCookieAdapter;

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
    vi.mocked(createAuthClient).mockReturnValue(mockAdminSupabase() as never);
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockServerSupabase() as never);
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

    const result = await signUp(
      { email: "a@test.local", password: "pw", name: "테스트", birthDate: "1990-01-01" },
      FAKE_COOKIE_ADAPTER
    );

    expect(result.session.accessToken).toBe("at");
    expect(result.user.id).toBe("auth-user-1");
    expect(userRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ agentPersonaId: "p1", id: "auth-user-1" })
    );
    // 세션 확립은 service-role이 아니라 쿠키 인식 클라이언트로 이뤄져야 한다.
    expect(createServerSupabaseClient).toHaveBeenCalledWith(FAKE_COOKIE_ADAPTER);
  });

  it("EMAIL_ALREADY_EXISTS: 중복 이메일", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: null }, error: { message: "User already registered" } });

    await expect(
      signUp({ email: "dup@test.local", password: "pw", name: "n", birthDate: "1990-01-01" }, FAKE_COOKIE_ADAPTER)
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_EXISTS" });
  });

  it("persona 매칭 실패해도 가입은 성공한다 (agentPersonaId=null)", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockRejectedValue(new Error("repo down"));
    vi.mocked(userRepository.createUser).mockResolvedValue(user({ agentPersonaId: null }));
    mockSignInWithPassword.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });

    const result = await signUp(
      { email: "a@test.local", password: "pw", name: "테스트", birthDate: "1990-01-01" },
      FAKE_COOKIE_ADAPTER
    );

    expect(result.user.id).toBe("auth-user-1");
    expect(userRepository.createUser).toHaveBeenCalledWith(expect.objectContaining({ agentPersonaId: null }));
  });

  it("user-repository 실패 시 auth 계정을 롤백한다 (deleteUser 호출)", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockResolvedValue(null);
    vi.mocked(userRepository.createUser).mockRejectedValue(new Error("db down"));

    await expect(
      signUp({ email: "a@test.local", password: "pw", name: "테스트", birthDate: "1990-01-01" }, FAKE_COOKIE_ADAPTER)
    ).rejects.toMatchObject({ code: "SIGNUP_FAILED" });

    expect(mockDeleteUser).toHaveBeenCalledWith("auth-user-1");
  });
});

describe("signIn (AC-001)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockServerSupabase() as never);
  });

  it("성공: 세션 + 프로필 정보 반환", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });
    vi.mocked(userRepository.getUserById).mockResolvedValue(user({}));

    const result = await signIn({ email: "a@test.local", password: "pw" }, FAKE_COOKIE_ADAPTER);

    expect(result.user.email).toBe("a@test.local");
    expect(result.session.accessToken).toBe("at");
  });

  it("INVALID_CREDENTIALS: 잘못된 비밀번호", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: { message: "invalid" } });

    await expect(signIn({ email: "a@test.local", password: "wrong" }, FAKE_COOKIE_ADAPTER)).rejects.toThrow(
      AuthError
    );
  });
});

describe("signOut (seed-v2, AC-006)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockServerSupabase() as never);
  });

  it("쿠키 인식 클라이언트의 signOut을 호출해 서버 측 세션을 무효화한다", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await signOut(FAKE_COOKIE_ADAPTER);
    expect(createServerSupabaseClient).toHaveBeenCalledWith(FAKE_COOKIE_ADAPTER);
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe("getSessionUser (AC-001, T-019, seed-v2 재작성)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockServerSupabase() as never);
  });

  it("유효한 세션이면 프로필을 반환한다", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(userRepository.getUserById).mockResolvedValue(user({}));

    const result = await getSessionUser(FAKE_COOKIE_ADAPTER);
    expect(result).toEqual({
      id: "auth-user-1",
      email: "a@test.local",
      name: "테스트",
      agentPersonaId: "p1",
      birthDate: "1990-01-01",
    });
  });

  it("세션이 유효하지 않으면 null을 반환한다(예외를 던지지 않음)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid session" } });
    expect(await getSessionUser(FAKE_COOKIE_ADAPTER)).toBeNull();
  });

  it("auth 유저는 있지만 public.users 프로필이 없으면 null을 반환한다", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } }, error: null });
    vi.mocked(userRepository.getUserById).mockResolvedValue(null);

    expect(await getSessionUser(FAKE_COOKIE_ADAPTER)).toBeNull();
  });

  it("캐싱 회귀 방지 — 서로 다른 쿠키 어댑터로 연속 호출해도 세션이 섞이지 않는다 (2026-09-11 버그 재발 감지)", async () => {
    const adapterA = { name: "A" } as unknown as SupabaseCookieAdapter;
    const adapterB = { name: "B" } as unknown as SupabaseCookieAdapter;

    const clientA = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-a" } }, error: null }) } };
    const clientB = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-b" } }, error: null }) } };

    vi.mocked(createServerSupabaseClient).mockImplementation((adapter) =>
      (adapter === adapterA ? clientA : clientB) as never
    );
    vi.mocked(userRepository.getUserById).mockImplementation(async (id) =>
      user({ id, email: `${id}@test.local` })
    );

    const resultA = await getSessionUser(adapterA);
    const resultB = await getSessionUser(adapterB);

    expect(resultA?.id).toBe("user-a");
    expect(resultB?.id).toBe("user-b");
    // 매 호출마다 넘겨받은 adapter로 정확히 새 클라이언트를 만들어야 한다 — 첫 호출
    // 결과를 모듈 스코프에 캐싱해 재사용하면 이 두 호출이 같은 값을 반환하게 된다.
    expect(createServerSupabaseClient).toHaveBeenNthCalledWith(1, adapterA);
    expect(createServerSupabaseClient).toHaveBeenNthCalledWith(2, adapterB);
  });
});

describe("exchangeGoogleSession (seed-v2, AC-001, AC-003)", () => {
  const GOOGLE_SESSION = {
    access_token: "gat",
    refresh_token: "grt",
    expires_at: 456,
  };

  function googleAuthUser(overrides: Record<string, unknown> = {}) {
    return {
      id: "google-user-1",
      email: "shared@test.local",
      user_metadata: { full_name: "구글유저" },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockServerSupabase() as never);
    vi.mocked(createAuthClient).mockReturnValue(mockAdminSupabase() as never);
  });

  it("교환 실패(코드 만료 등) 시 OAUTH_EXCHANGE_FAILED를 던진다", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error: { message: "invalid code" } });

    await expect(exchangeGoogleSession("bad-code", {} as SupabaseCookieAdapter)).rejects.toMatchObject({
      code: "OAUTH_EXCHANGE_FAILED",
    });
  });

  it("이미 public.users에 있는 유저(재로그인/정상 자동연결)면 그대로 세션을 반환한다", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: GOOGLE_SESSION, user: googleAuthUser() },
      error: null,
    });
    vi.mocked(userRepository.getUserById).mockResolvedValue(
      user({ id: "google-user-1", email: "shared@test.local" })
    );

    const result = await exchangeGoogleSession("good-code", {} as SupabaseCookieAdapter);

    expect(result.user.id).toBe("google-user-1");
    expect(result.session.accessToken).toBe("gat");
    // 이미 있는 유저이므로 새로 만들 필요가 없다.
    expect(userRepository.createUser).not.toHaveBeenCalled();
  });

  it("완전 신규 유저면 이름을 구글 프로필에서 뽑아 생성한다", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: GOOGLE_SESSION, user: googleAuthUser() },
      error: null,
    });
    vi.mocked(userRepository.getUserById).mockResolvedValue(null);
    vi.mocked(userRepository.getUserByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.createUser).mockResolvedValue(
      user({ id: "google-user-1", email: "shared@test.local", name: "구글유저", birthDate: null })
    );

    const result = await exchangeGoogleSession("good-code", {} as SupabaseCookieAdapter);

    expect(userRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "google-user-1", email: "shared@test.local", name: "구글유저", agentPersonaId: null })
    );
    expect(result.user.id).toBe("google-user-1");
  });

  it("사전 비교에서 이메일이 다른 유저 소유로 확인되면 거부하고 orphan 계정을 정리한다", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: GOOGLE_SESSION, user: googleAuthUser() },
      error: null,
    });
    vi.mocked(userRepository.getUserById).mockResolvedValue(null);
    vi.mocked(userRepository.getUserByEmail).mockResolvedValue(
      user({ id: "someone-else", email: "shared@test.local" })
    );

    await expect(exchangeGoogleSession("good-code", {} as SupabaseCookieAdapter)).rejects.toMatchObject({
      code: "OAUTH_EMAIL_NOT_VERIFIED",
    });

    // orphan auth.users 삭제
    expect(mockDeleteUser).toHaveBeenCalledWith("google-user-1");
    // 이미 심긴 세션 쿠키를 서버 레벨에서 무효화 — admin.deleteUser만으로는 부족하다.
    expect(mockSignOut).toHaveBeenCalled();
    expect(userRepository.createUser).not.toHaveBeenCalled();
  });

  it("createUser가 DuplicateEmailError를 던지는 경우(사전 비교를 통과했지만 DB 레벨에서 걸린 안전망)도 동일하게 거부 처리한다", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: GOOGLE_SESSION, user: googleAuthUser() },
      error: null,
    });
    vi.mocked(userRepository.getUserById).mockResolvedValue(null);
    vi.mocked(userRepository.getUserByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.createUser).mockRejectedValue(new DuplicateEmailError("shared@test.local"));

    await expect(exchangeGoogleSession("good-code", {} as SupabaseCookieAdapter)).rejects.toMatchObject({
      code: "OAUTH_EMAIL_NOT_VERIFIED",
    });
    expect(mockDeleteUser).toHaveBeenCalledWith("google-user-1");
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe("completeOnboarding (seed-v2, AC-004)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("정상 매칭: birthDate 저장 + agentPersonaId 반환", async () => {
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockResolvedValue({
      id: "p-30s",
      ageBand: "30s",
      tone: "t",
      systemPrompt: "s",
    });
    vi.mocked(userRepository.updateProfile).mockResolvedValue(
      user({ birthDate: "1995-03-01", agentPersonaId: "p-30s" })
    );

    const result = await completeOnboarding("u1", "1995-03-01");

    expect(userRepository.updateProfile).toHaveBeenCalledWith("u1", {
      birthDate: "1995-03-01",
      agentPersonaId: "p-30s",
    });
    expect(result).toEqual({ birthDate: "1995-03-01", agentPersonaId: "p-30s" });
  });

  it("이미 agentPersonaId가 있는 유저의 재입력도 그대로 갱신한다(재매칭 재시도 허용)", async () => {
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockResolvedValue({
      id: "p-40s",
      ageBand: "40s",
      tone: "t",
      systemPrompt: "s",
    });
    vi.mocked(userRepository.updateProfile).mockResolvedValue(
      user({ birthDate: "1985-01-01", agentPersonaId: "p-40s" })
    );

    const result = await completeOnboarding("u1", "1985-01-01");
    expect(result.agentPersonaId).toBe("p-40s");
  });

  it("persona 매칭이 기술적으로 실패해도 birthDate는 저장되고 agentPersonaId=null로 계속 진행한다 (관용 정책)", async () => {
    vi.mocked(agentPersonaService.getPersonaForBirthDate).mockRejectedValue(new Error("db down"));
    vi.mocked(userRepository.updateProfile).mockResolvedValue(
      user({ birthDate: "1995-03-01", agentPersonaId: null })
    );

    const result = await completeOnboarding("u1", "1995-03-01");

    expect(userRepository.updateProfile).toHaveBeenCalledWith("u1", {
      birthDate: "1995-03-01",
      agentPersonaId: null,
    });
    expect(result.agentPersonaId).toBeNull();
  });
});
