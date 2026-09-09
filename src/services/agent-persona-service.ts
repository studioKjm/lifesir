// T-009 — birthDate → AgeBand 매핑 (AC-002)
import * as agentPersonaRepository from "@/lib/data/agent-persona-repository";
import type { AgentPersonaRecord } from "@/lib/data/records";
import type { AgeBand } from "@/types/dto";

export function calculateAge(birthDate: string, referenceDate: Date = new Date()): number {
  const birth = new Date(birthDate);
  let age = referenceDate.getFullYear() - birth.getFullYear();
  const hasNotHadBirthdayThisYear =
    referenceDate.getMonth() < birth.getMonth() ||
    (referenceDate.getMonth() === birth.getMonth() && referenceDate.getDate() < birth.getDate());
  if (hasNotHadBirthdayThisYear) age -= 1;
  return age;
}

export function mapAgeToBand(age: number): AgeBand {
  if (age < 20) return "10s";
  if (age < 30) return "20s";
  if (age < 40) return "30s";
  if (age < 50) return "40s";
  return "50s_plus";
}

/** birthDate로 나이대를 계산하고, 매칭되는 AgentPersona를 조회한다. */
export async function getPersonaForBirthDate(
  birthDate: string,
  referenceDate?: Date
): Promise<AgentPersonaRecord | null> {
  const ageBand = mapAgeToBand(calculateAge(birthDate, referenceDate));
  return agentPersonaRepository.getByAgeBand(ageBand);
}
