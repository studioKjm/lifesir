// T-004 — User 레포지토리 (AC-001)
// public.users는 auth.users를 1:1 확장한다. id는 Supabase Auth가 발급한 값을 그대로 쓴다.
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError, DuplicateEmailError } from "@/lib/data/errors";
import type { UserRecord } from "@/lib/data/records";

function toRecord(row: {
  id: string;
  email: string;
  name: string;
  birth_date: string | null;
  agent_persona_id: string | null;
  created_at: string;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    birthDate: row.birth_date,
    agentPersonaId: row.agent_persona_id,
    createdAt: row.created_at,
  };
}

export interface CreateUserInput {
  id: string; // = auth.users.id
  email: string;
  name: string;
  // seed-v2: 구글 신규가입 시점엔 없다 — 온보딩에서 updateProfile로 채워진다.
  birthDate?: string;
  agentPersonaId: string | null;
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .insert({
      id: input.id,
      email: input.email,
      name: input.name,
      birth_date: input.birthDate ?? null,
      agent_persona_id: input.agentPersonaId,
    })
    .select("id, email, name, birth_date, agent_persona_id, created_at")
    .single();

  if (error) {
    // seed-v2, AC-003 — 이 제약(users_email_key) 위반은 "구글 계정 자동연결
    // 실패"를 감지하는 유일한 신호다. 다른 23505(우연히 같은 코드를 쓰는 다른
    // 제약)까지 오인하지 않도록 제약 이름까지 확인한다.
    if (error.code === "23505" && error.message.includes("users_email_key")) {
      throw new DuplicateEmailError(input.email, { cause: error });
    }
    throw new RepositoryError(`User 생성 실패 (email=${input.email})`, { cause: error });
  }
  return toRecord(data);
}

/** T-004 (seed-v2, AC-004) — 온보딩 완료 시 생년월일 + 매칭된 AgentPersona를 채운다. */
export async function updateProfile(
  id: string,
  input: { birthDate: string; agentPersonaId: string | null }
): Promise<UserRecord> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .update({ birth_date: input.birthDate, agent_persona_id: input.agentPersonaId })
    .eq("id", id)
    .select("id, email, name, birth_date, agent_persona_id, created_at")
    .single();

  if (error) throw new RepositoryError(`User 프로필 갱신 실패 (id=${id})`, { cause: error });
  return toRecord(data);
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .select("id, email, name, birth_date, agent_persona_id, created_at")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new RepositoryError(`User 조회 실패 (email=${email})`, { cause: error });
  return data ? toRecord(data) : null;
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .select("id, email, name, birth_date, agent_persona_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new RepositoryError(`User 조회 실패 (id=${id})`, { cause: error });
  return data ? toRecord(data) : null;
}
