// T-008 — Message 레포지토리 (AC-008)
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { MessageRecord } from "@/lib/data/records";
import type { MessageRole } from "@/types/dto";

function toRecord(row: {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

const COLUMNS = "id, conversation_id, role, content, created_at";

export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string
): Promise<MessageRecord> {
  const { data, error } = await getSupabaseClient()
    .from("messages")
    .insert({ conversation_id: conversationId, role, content })
    .select(COLUMNS)
    .single();

  if (error) throw new RepositoryError(`Message 생성 실패 (conversationId=${conversationId})`, { cause: error });
  return toRecord(data);
}

export async function getRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("messages")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new RepositoryError(`Message 조회 실패 (conversationId=${conversationId})`, { cause: error });
  return (data ?? []).map(toRecord).reverse();
}
