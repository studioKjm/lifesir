// T-005 — AgentPersona 레포지토리 (AC-002)
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { AgentPersonaRecord } from "@/lib/data/records";
import type { AgeBand } from "@/types/dto";

function toRecord(row: {
  id: string;
  age_band: AgeBand;
  tone: string;
  system_prompt: string;
}): AgentPersonaRecord {
  return { id: row.id, ageBand: row.age_band, tone: row.tone, systemPrompt: row.system_prompt };
}

export async function getByAgeBand(ageBand: AgeBand): Promise<AgentPersonaRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("agent_personas")
    .select("id, age_band, tone, system_prompt")
    .eq("age_band", ageBand)
    .maybeSingle();

  if (error) throw new RepositoryError(`AgentPersona 조회 실패 (age_band=${ageBand})`, { cause: error });
  return data ? toRecord(data) : null;
}

export async function getById(id: string): Promise<AgentPersonaRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("agent_personas")
    .select("id, age_band, tone, system_prompt")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new RepositoryError(`AgentPersona 조회 실패 (id=${id})`, { cause: error });
  return data ? toRecord(data) : null;
}
