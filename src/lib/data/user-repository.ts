// T-004 — User 레포지토리 (AC-001)
// public.users는 auth.users를 1:1 확장한다. id는 Supabase Auth가 발급한 값을 그대로 쓴다.
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { UserRecord } from "@/lib/data/records";

function toRecord(row: {
  id: string;
  email: string;
  name: string;
  birth_date: string;
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
  birthDate: string;
  agentPersonaId: string | null;
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .insert({
      id: input.id,
      email: input.email,
      name: input.name,
      birth_date: input.birthDate,
      agent_persona_id: input.agentPersonaId,
    })
    .select("id, email, name, birth_date, agent_persona_id, created_at")
    .single();

  if (error) throw new RepositoryError(`User 생성 실패 (email=${input.email})`, { cause: error });
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
