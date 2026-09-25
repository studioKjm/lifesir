// T-027 (seed-v4, AC-005, AC-007, AC-008) — 이상 상태 탐지 페이지.
// (1) partial_failure로 방치된 구독(recoverable/not_recoverable/undetermined)
// (2) 중복으로 유효한 Subscription을 가진 유저(조회 전용, 수정 기능 없음).
// 복구 버튼(AC-006)은 recoverable 행에서 실제로 동작하는 Server Action에
// 연결된다 — not_recoverable/undetermined는 여전히 버튼 엘리먼트 자체가 없다.
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/app/_lib/session";
import { isAdminEmail, detectStuckSubscriptions, detectDuplicateActiveSubscriptions } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import { RecoverSubscriptionButton } from "@/components/RecoverSubscriptionButton";
import { recoverStuckSubscriptionAction } from "./actions";
import type { StuckClassification } from "@/services/admin-service";
import styles from "../admin.module.css";

export const metadata = { title: "이상 상태 탐지 — 관리자 — 동행" };

const CLASSIFICATION_LABEL: Record<StuckClassification, string> = {
  recoverable: "복구 가능",
  not_recoverable: "복구 불가",
  undetermined: "판단 불가",
};

const NOTICE_COPY: Record<string, string> = {
  recovered: "구독을 복구했어요.",
  recovered_log_failed: "구독은 복구됐지만 감사 로그 기록에는 실패했어요. 서버 로그를 확인해주세요.",
};

const ERROR_COPY: Record<string, string> = {
  NOT_RECOVERABLE: "복구할 수 없는 상태예요 — 서버 재검증에서 거부됐어요.",
  SUBSCRIPTION_NOT_FOUND: "해당 구독을 찾을 수 없어요.",
  INVALID_INPUT: "잘못된 요청이에요.",
};

export default async function AdminAnomaliesPage({ searchParams }: PageProps<"/admin/anomalies">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminEmail(session.email)) redirect("/dashboard");

  const { notice, error } = await searchParams;
  const noticeCode = Array.isArray(notice) ? notice[0] : notice;
  const errorCode = Array.isArray(error) ? error[0] : error;

  const [stuck, duplicates] = await Promise.all([detectStuckSubscriptions(), detectDuplicateActiveSubscriptions()]);

  return (
    <AppShell active="admin" user={session} isAdmin>
      <h1 className="page-title">이상 상태 탐지</h1>
      <p className="page-subtitle">결제 실패로 방치된 구독과 중복 구독을 확인하세요.</p>

      {noticeCode && NOTICE_COPY[noticeCode] && <p className="page-subtitle">{NOTICE_COPY[noticeCode]}</p>}
      {errorCode && <p className="page-subtitle">{ERROR_COPY[errorCode] ?? "오류가 발생했어요."}</p>}

      <section className="card">
        <h2 className={styles.sectionTitle}>방치된 구독 (partial_failure 의심)</h2>
        {stuck.length === 0 ? (
          <p className="page-subtitle">방치된 구독이 없어요.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>구독자</th>
                  <th>판정</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stuck.map(({ subscription, classification }) => (
                  <tr key={subscription.id}>
                    <td>
                      <Link href={`/admin/subscribers/${subscription.userId}`}>상세 보기</Link>
                    </td>
                    <td className="data-table__value">{CLASSIFICATION_LABEL[classification]}</td>
                    <td>
                      {classification === "recoverable" && (
                        <form action={recoverStuckSubscriptionAction}>
                          <input type="hidden" name="subscriptionId" value={subscription.id} />
                          <RecoverSubscriptionButton />
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className={styles.sectionTitle}>중복으로 유효한 구독을 가진 유저</h2>
        {duplicates.length === 0 ? (
          <p className="page-subtitle">중복 구독이 발견되지 않았어요.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>구독자</th>
                  <th>중복 건수</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.map((group) => (
                  <tr key={group.userId}>
                    <td>
                      <Link href={`/admin/subscribers/${group.userId}`}>상세 보기</Link>
                    </td>
                    <td className="data-table__value">{group.subscriptions.length}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
