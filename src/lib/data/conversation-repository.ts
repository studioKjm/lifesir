// T-008 — Conversation 레포지토리 (AC-008)
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { ConversationRecord } from "@/lib/data/records";

function toRecord(row: {
  id: string;
  user_id: string;
  agent_persona_id: string;
  started_at: string;
}): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    agentPersonaId: row.agent_persona_id,
    startedAt: row.started_at,
  };
}

const COLUMNS = "id, user_id, agent_persona_id, started_at";

export async function createConversation(userId: string, agentPersonaId: string): Promise<ConversationRecord> {
  const { data, error } = await getSupabaseClient()
    .from("conversations")
    .insert({ user_id: userId, agent_persona_id: agentPersonaId })
    .select(COLUMNS)
    .single();

  if (error) throw new RepositoryError(`Conversation 생성 실패 (userId=${userId})`, { cause: error });
  return toRecord(data);
}

export async function getById(id: string): Promise<ConversationRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("conversations")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new RepositoryError(`Conversation 조회 실패 (id=${id})`, { cause: error });
  return data ? toRecord(data) : null;
}
