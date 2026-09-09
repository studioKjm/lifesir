import { describe, expect, it } from "vitest";
import * as agentPersonaRepository from "@/lib/data/agent-persona-repository";
import type { AgeBand } from "@/types/dto";

const ALL_BANDS: AgeBand[] = ["10s", "20s", "30s", "40s", "50s_plus"];

describe("agent-persona-repository (통합, 로컬 Supabase)", () => {
  it.each(ALL_BANDS)("age_band=%s 시드 데이터가 조회된다", async (band) => {
    const persona = await agentPersonaRepository.getByAgeBand(band);
    expect(persona).not.toBeNull();
    expect(persona?.ageBand).toBe(band);
    expect(persona?.systemPrompt.length).toBeGreaterThan(0);
  });

  it("존재하지 않는 id는 null을 반환한다", async () => {
    const result = await agentPersonaRepository.getById("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});
