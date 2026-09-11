import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as careLinkService from "@/services/care-link-service";
import { AppShell } from "@/components/AppShell";
import { CareLinkRequestCard } from "@/components/CareLinkRequestCard";
import { EmptyState } from "@/components/EmptyState";
import { requestCareLinkAction } from "./actions";

export const metadata = { title: "케어링크 — 동행" };

const ERROR_COPY: Record<string, string> = {
  INVALID_INPUT: "상대방 이메일을 입력해주세요.",
  TARGET_NOT_FOUND: "가입된 사용자를 찾을 수 없어요. 이메일을 다시 확인해주세요.",
  SELF_REQUEST: "자기 자신에게는 연결을 요청할 수 없어요.",
  LINK_ALREADY_EXISTS: "이미 연결 요청을 보냈거나 연결되어 있어요.",
  LINK_NOT_FOUND: "요청을 찾을 수 없어요.",
  NOT_TARGET_USER: "이 요청에 응답할 권한이 없어요.",
  NOT_PENDING: "이미 처리된 요청이에요.",
};

export default async function CareLinksPage({ searchParams }: PageProps<"/care-links">) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  const links = await careLinkService.listCareLinks(session.id);
  const received = links.filter((l) => l.direction === "received");
  const sent = links.filter((l) => l.direction === "sent");

  return (
    <AppShell active="care-links" user={session}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 6 }}>케어링크</h1>
        <p style={{ color: "var(--ink-muted)", fontSize: 14 }}>
          가족의 이메일로 연결을 요청하고, 상대가 수락하면 건강 기록을 확인할 수 있어요.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, alignItems: "start" }}>
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>새 연결 요청</h2>
          {errorCode && (
            <div role="alert" style={{ marginBottom: 14 }}>
              <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
            </div>
          )}
          <form action={requestCareLinkAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label htmlFor="targetEmail">상대방 이메일</label>
              <input id="targetEmail" name="targetEmail" type="email" placeholder="parent@example.com" required />
            </div>
            <button type="submit" className="btn btn--primary btn--block">
              연결 요청 보내기
            </button>
          </form>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <section className="card">
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>받은 요청</h2>
            {received.length === 0 ? (
              <EmptyState variant="empty" description="아직 받은 연결 요청이 없어요." />
            ) : (
              received.map((item) => <CareLinkRequestCard key={item.id} item={item} />)
            )}
          </section>

          <section className="card">
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>내가 보낸 요청</h2>
            {sent.length === 0 ? (
              <EmptyState variant="empty" description="아직 보낸 연결 요청이 없어요." />
            ) : (
              sent.map((item) => <CareLinkRequestCard key={item.id} item={item} />)
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
