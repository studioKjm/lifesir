import { describe, expect, it, vi, beforeEach } from "vitest";
import { calculateAge, mapAgeToBand, getPersonaForBirthDate } from "@/services/agent-persona-service";
import * as agentPersonaRepository from "@/lib/data/agent-persona-repository";

vi.mock("@/lib/data/agent-persona-repository");

const REF = new Date("2026-09-09T00:00:00Z");

describe("calculateAge", () => {
  it("생일이 지난 경우 정확한 나이를 계산한다", () => {
    expect(calculateAge("2000-01-01", REF)).toBe(26);
  });

  it("올해 생일이 아직 안 지난 경우 1을 뺀다", () => {
    expect(calculateAge("2000-12-31", REF)).toBe(25);
  });

  it("생일 당일이면 이미 지난 것으로 계산한다", () => {
    expect(calculateAge("2000-09-09", REF)).toBe(26);
  });
});

describe("mapAgeToBand — 경계값", () => {
  it.each([
    [10, "10s"],
    [19, "10s"],
    [20, "20s"],
    [29, "20s"],
    [30, "30s"],
    [39, "30s"],
    [40, "40s"],
    [49, "40s"],
    [50, "50s_plus"],
    [80, "50s_plus"],
  ] as const)("age=%i → %s", (age, expected) => {
    expect(mapAgeToBand(age)).toBe(expected);
  });
});

describe("getPersonaForBirthDate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("계산된 age_band로 레포지토리를 조회한다", async () => {
    const persona = { id: "p1", ageBand: "30s" as const, tone: "t", systemPrompt: "s" };
    vi.mocked(agentPersonaRepository.getByAgeBand).mockResolvedValue(persona);

    const result = await getPersonaForBirthDate("1995-05-01", REF);

    expect(agentPersonaRepository.getByAgeBand).toHaveBeenCalledWith("30s");
    expect(result).toBe(persona);
  });
});
