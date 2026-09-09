import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  requestCareLink,
  respondCareLink,
  assertCareLinkAccepted,
  CareLinkError,
} from "@/services/care-link-service";
import * as careLinkRepository from "@/lib/data/care-link-repository";
import * as userRepository from "@/lib/data/user-repository";
import type { CareLinkRecord } from "@/lib/data/records";
import type { UserRecord } from "@/lib/data/records";

vi.mock("@/lib/data/care-link-repository");
vi.mock("@/lib/data/user-repository");

function user(overrides: Partial<UserRecord>): UserRecord {
  return {
    id: "u-target",
    email: "target@test.local",
    name: "Target",
    birthDate: "1990-01-01",
    agentPersonaId: null,
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

function link(overrides: Partial<CareLinkRecord>): CareLinkRecord {
  return {
    id: "link-1",
    requesterUserId: "u-requester",
    targetUserId: "u-target",
    status: "pending",
    consentConfirmedAt: null,
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

describe("requestCareLink (AC-003)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("성공: 대상 유저 존재 + 관계 없음 → pending 생성", async () => {
    vi.mocked(userRepository.getUserByEmail).mockResolvedValue(user({ id: "u-target" }));
    vi.mocked(careLinkRepository.findBetween).mockResolvedValue(null);
    vi.mocked(careLinkRepository.create).mockResolvedValue(link({}));

    const result = await requestCareLink("u-requester", "target@test.local");

    expect(result.status).toBe("pending");
    expect(careLinkRepository.create).toHaveBeenCalledWith("u-requester", "u-target");
  });

  it("TARGET_NOT_FOUND: 대상 이메일이 존재하지 않음", async () => {
    vi.mocked(userRepository.getUserByEmail).mockResolvedValue(null);

    await expect(requestCareLink("u-requester", "nobody@test.local")).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
    });
  });

  it("SELF_REQUEST: 자기 자신에게 요청", async () => {
    vi.mocked(userRepository.getUserByEmail).mockResolvedValue(user({ id: "u-requester" }));

    await expect(requestCareLink("u-requester", "me@test.local")).rejects.toMatchObject({
      code: "SELF_REQUEST",
    });
  });

  it.each(["pending", "accepted", "rejected"] as const)(
    "LINK_ALREADY_EXISTS: 기존 관계 status=%s 여도 재요청 차단",
    async (status) => {
      vi.mocked(userRepository.getUserByEmail).mockResolvedValue(user({ id: "u-target" }));
      vi.mocked(careLinkRepository.findBetween).mockResolvedValue(link({ status }));

      await expect(requestCareLink("u-requester", "target@test.local")).rejects.toMatchObject({
        code: "LINK_ALREADY_EXISTS",
      });
    }
  );
});

describe("respondCareLink (AC-003)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("성공: 대상자가 accept → accepted", async () => {
    vi.mocked(careLinkRepository.getById).mockResolvedValue(link({ status: "pending" }));
    vi.mocked(careLinkRepository.updateStatus).mockResolvedValue(link({ status: "accepted" }));

    const result = await respondCareLink("u-target", "link-1", "accept");

    expect(result.status).toBe("accepted");
    expect(careLinkRepository.updateStatus).toHaveBeenCalledWith("link-1", "accepted");
  });

  it("성공: 대상자가 reject → rejected", async () => {
    vi.mocked(careLinkRepository.getById).mockResolvedValue(link({ status: "pending" }));
    vi.mocked(careLinkRepository.updateStatus).mockResolvedValue(link({ status: "rejected" }));

    const result = await respondCareLink("u-target", "link-1", "reject");
    expect(result.status).toBe("rejected");
  });

  it("LINK_NOT_FOUND: 존재하지 않는 careLinkId", async () => {
    vi.mocked(careLinkRepository.getById).mockResolvedValue(null);

    await expect(respondCareLink("u-target", "missing", "accept")).rejects.toMatchObject({
      code: "LINK_NOT_FOUND",
    });
  });

  it("NOT_TARGET_USER: 타인이 응답 시도", async () => {
    vi.mocked(careLinkRepository.getById).mockResolvedValue(link({ targetUserId: "u-target" }));

    await expect(respondCareLink("u-stranger", "link-1", "accept")).rejects.toMatchObject({
      code: "NOT_TARGET_USER",
    });
  });

  it("NOT_PENDING: 이미 accepted 상태에 재응답", async () => {
    vi.mocked(careLinkRepository.getById).mockResolvedValue(link({ status: "accepted" }));

    await expect(respondCareLink("u-target", "link-1", "accept")).rejects.toMatchObject({
      code: "NOT_PENDING",
    });
  });
});

describe("assertCareLinkAccepted (AC-004)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requester가 target에 접근 — accepted면 통과한다 (예외 없음)", async () => {
    // 자녀(u-child)가 요청자, 부모(u-parent)가 대상자 — 자녀가 부모 데이터에 접근하는 정방향
    vi.mocked(careLinkRepository.findBetween).mockResolvedValue(
      link({ requesterUserId: "u-child", targetUserId: "u-parent", status: "accepted" })
    );
    await expect(assertCareLinkAccepted("u-child", "u-parent")).resolves.toBeUndefined();
  });

  it.each(["pending", "rejected", "revoked"] as const)("status=%s면 NOT_AUTHORIZED", async (status) => {
    vi.mocked(careLinkRepository.findBetween).mockResolvedValue(
      link({ requesterUserId: "u-child", targetUserId: "u-parent", status })
    );
    await expect(assertCareLinkAccepted("u-child", "u-parent")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("관계 자체가 없으면 NOT_AUTHORIZED", async () => {
    vi.mocked(careLinkRepository.findBetween).mockResolvedValue(null);
    await expect(assertCareLinkAccepted("u-child", "u-parent")).rejects.toThrow(CareLinkError);
  });

  it("역방향 접근 차단: accepted 관계라도 target이었던 쪽이 actor로 접근하면 NOT_AUTHORIZED (Navigator 리뷰로 발견된 버그 회귀 방지)", async () => {
    // "자녀(u-child)→부모(u-parent)" 방향만 허용하는 accepted 관계.
    vi.mocked(careLinkRepository.findBetween).mockResolvedValue(
      link({ requesterUserId: "u-child", targetUserId: "u-parent", status: "accepted" })
    );
    // 부모(u-parent)가 반대로 자녀(u-child)의 데이터에 접근을 시도 — 방향이 뒤바뀐 호출이므로 거부되어야 한다.
    await expect(assertCareLinkAccepted("u-parent", "u-child")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("actorId===targetId(자기 자신)여도 CareLink 없이는 통과시키지 않는다 (Test Designer 발견 — 본인 접근은 이 가드의 책임 범위 밖임을 문서화)", async () => {
    vi.mocked(careLinkRepository.findBetween).mockResolvedValue(null);
    await expect(assertCareLinkAccepted("u-self", "u-self")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });
});
