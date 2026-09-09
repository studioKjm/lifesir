// T-010, T-011 — CareLink 요청/응답 + 권한 가드 (AC-003, AC-004)
// Pair Mode(Navigator Plan A)로 설계됨 — 근거는 각 함수 주석 참고.
import * as careLinkRepository from "@/lib/data/care-link-repository";
import * as userRepository from "@/lib/data/user-repository";
import type { CareLinkRecord } from "@/lib/data/records";
import type { CareLinkDTO } from "@/types/dto";

export type CareLinkErrorCode =
  | "TARGET_NOT_FOUND"
  | "SELF_REQUEST"
  | "LINK_ALREADY_EXISTS"
  | "LINK_NOT_FOUND"
  | "NOT_TARGET_USER"
  | "NOT_PENDING"
  | "NOT_AUTHORIZED";

export class CareLinkError extends Error {
  code: CareLinkErrorCode;
  constructor(code: CareLinkErrorCode, message: string) {
    super(message);
    this.name = "CareLinkError";
    this.code = code;
  }
}

function toDTO(record: CareLinkRecord): CareLinkDTO {
  return {
    id: record.id,
    requesterUserId: record.requesterUserId,
    targetUserId: record.targetUserId,
    status: record.status,
    createdAt: record.createdAt,
  };
}

/**
 * CareLink 요청을 생성한다.
 * care-link-repository.findBetween()은 두 유저 사이에 0~1행만 있다고 가정한다
 * (.maybeSingle() 사용). 따라서 상태와 무관하게 기존 행이 있으면 재요청을 막는다
 * — rejected 이후 재요청 UX는 이번 스코프 밖(seed-v1 tech_decisions: 부모-자녀
 * 동의 UX는 이후 개선). T-011의 assertCareLinkAccepted도 이 함수와 동일하게
 * findBetween을 재사용하므로 이 invariant(쌍당 최대 1행)를 함께 지킨다.
 */
export async function requestCareLink(requesterUserId: string, targetEmail: string): Promise<CareLinkDTO> {
  const target = await userRepository.getUserByEmail(targetEmail);
  if (!target) {
    throw new CareLinkError("TARGET_NOT_FOUND", `대상 사용자를 찾을 수 없습니다 (email=${targetEmail})`);
  }
  if (target.id === requesterUserId) {
    throw new CareLinkError("SELF_REQUEST", "자기 자신에게는 연결을 요청할 수 없습니다");
  }

  const existing = await careLinkRepository.findBetween(requesterUserId, target.id);
  if (existing) {
    throw new CareLinkError("LINK_ALREADY_EXISTS", "이미 연결 요청이 존재합니다");
  }

  const created = await careLinkRepository.create(requesterUserId, target.id);
  return toDTO(created);
}

export async function respondCareLink(
  userId: string,
  careLinkId: string,
  decision: "accept" | "reject"
): Promise<CareLinkDTO> {
  const link = await careLinkRepository.getById(careLinkId);
  if (!link) {
    throw new CareLinkError("LINK_NOT_FOUND", `CareLink를 찾을 수 없습니다 (id=${careLinkId})`);
  }
  if (link.targetUserId !== userId) {
    throw new CareLinkError("NOT_TARGET_USER", "이 요청에 응답할 권한이 없습니다");
  }
  if (link.status !== "pending") {
    throw new CareLinkError("NOT_PENDING", `이미 처리된 요청입니다 (status=${link.status})`);
  }

  const updated = await careLinkRepository.updateStatus(careLinkId, decision === "accept" ? "accepted" : "rejected");
  return toDTO(updated);
}

/**
 * AC-004 — actorId가 targetId의 데이터를 조회/대리기록할 권한이 있는지 검증한다.
 *
 * 권한은 방향성을 가진다: seed-v1 ontology.actions.RespondCareLink.side_effects에
 * "accepted 시 **요청자(requester)**에게 대상자(target) 대시보드 열람 권한 부여"라고
 * 명시되어 있다 — target → requester 방향의 접근은 정의되어 있지 않다.
 * findBetween()은 관계 존재 여부만 방향 무관으로 조회하므로, 여기서 반드시
 * requesterUserId===actorId && targetUserId===targetId를 별도로 확인해야 한다
 * (Navigator 리뷰로 발견된 방향성 누락 버그 — 없으면 target이었던 쪽도 통과해버림).
 */
export async function assertCareLinkAccepted(actorId: string, targetId: string): Promise<void> {
  const link = await careLinkRepository.findBetween(actorId, targetId);
  const authorized =
    !!link && link.status === "accepted" && link.requesterUserId === actorId && link.targetUserId === targetId;
  if (!authorized) {
    throw new CareLinkError("NOT_AUTHORIZED", `${targetId}에 대한 접근 권한이 없습니다 (CareLink 미승인)`);
  }
}
