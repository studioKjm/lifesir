// T-025 (seed-v4, AC-002, AC-008) — 구독자 검색/목록 페이지.
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/app/_lib/session";
import { isAdminEmail, listSubscribers } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import type { SubscriptionStatus } from "@/types/dto";
import styles from "../admin.module.css";

export const metadata = { title: "구독자 목록 — 관리자 — 동행" };

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: "무료체험",
  active: "이용중",
  past_due: "결제실패",
  canceled: "해지(유예)",
  expired: "만료",
};
const ALL_STATUSES: SubscriptionStatus[] = ["trial", "active", "past_due", "canceled", "expired"];

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (ALL_STATUSES as string[]).includes(value);
}

function buildHref(search: string, status: string, page: number): string {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/subscribers?${qs}` : "/admin/subscribers";
}

export default async function AdminSubscribersPage({ searchParams }: PageProps<"/admin/subscribers">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminEmail(session.email)) redirect("/dashboard");

  const params = await searchParams;
  const search = (Array.isArray(params.search) ? params.search[0] : params.search) ?? "";
  const rawStatus = (Array.isArray(params.status) ? params.status[0] : params.status) ?? "";
  const status = isSubscriptionStatus(rawStatus) ? rawStatus : "";
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number(rawPage) || 1);

  const result = await listSubscribers({
    search: search || undefined,
    status: status || undefined,
    page,
  });
  const hasNextPage = result.page * result.pageSize < result.totalCount;

  return (
    <AppShell active="admin" user={session} isAdmin>
      <h1 className="page-title">구독자 목록</h1>
      <p className="page-subtitle">전체 {result.totalCount.toLocaleString("ko-KR")}명</p>

      <form method="get" className={styles.monthForm}>
        <label htmlFor="search">검색</label>
        <input id="search" type="text" name="search" defaultValue={search} placeholder="이메일 또는 이름" />
        <label htmlFor="status">상태</label>
        <select id="status" name="status" defaultValue={status}>
          <option value="">전체</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn--ghost btn--sm">
          조회
        </button>
      </form>

      <section className="card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>이메일</th>
                <th>이름</th>
                <th>플랜</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.userId}>
                  <td>{item.email}</td>
                  <td>{item.name}</td>
                  <td>{item.plan === "monthly" ? "월간" : "연간"}</td>
                  <td className="data-table__value">{STATUS_LABEL[item.status]}</td>
                  <td>
                    <Link href={`/admin/subscribers/${item.userId}`}>상세</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.items.length === 0 && <p className="page-subtitle">조건에 맞는 구독자가 없어요.</p>}
      </section>

      <nav aria-label="페이지네이션" className={styles.monthForm}>
        {page > 1 && <Link href={buildHref(search, status, page - 1)}>이전</Link>}
        <span>{page} 페이지</span>
        {hasNextPage && <Link href={buildHref(search, status, page + 1)}>다음</Link>}
      </nav>
    </AppShell>
  );
}
