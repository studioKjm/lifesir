// T-020 — CareLink 목록의 한 행. 방향(direction)/상태(status)에 따라
// 수락·거절 버튼 또는 상태 뱃지를 보여준다 (AC-003, AC-004).
import Link from "next/link";
import type { CareLinkListItemDTO } from "@/types/dto";
import { respondCareLinkAction } from "@/app/care-links/actions";
import styles from "./CareLinkRequestCard.module.css";

export interface CareLinkRequestCardProps {
  item: CareLinkListItemDTO;
}

export function CareLinkRequestCard({ item }: CareLinkRequestCardProps) {
  const displayName = item.counterpart?.name ?? "알 수 없는 사용자";
  const displayEmail = item.counterpart?.email ?? "";

  return (
    <div className={styles.row}>
      <span className={styles.avatar} aria-hidden="true">
        {displayName.slice(0, 1)}
      </span>
      <div className={styles.info}>
        <p className={styles.name}>{displayName}</p>
        <p className={styles.meta}>
          {displayEmail} · {item.direction === "sent" ? "내가 보낸 요청" : "받은 요청"}
        </p>
      </div>
      <div className={styles.actions}>
        {item.status === "pending" && item.direction === "received" && (
          <form action={respondCareLinkAction} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="careLinkId" value={item.id} />
            <button type="submit" name="decision" value="accept" className="btn btn--primary btn--sm">
              수락
            </button>
            <button type="submit" name="decision" value="reject" className="btn btn--ghost btn--sm">
              거절
            </button>
          </form>
        )}
        {item.status === "pending" && item.direction === "sent" && <span className="badge badge--wait">응답 대기중</span>}
        {item.status === "accepted" && item.direction === "sent" && (
          <>
            <span className="badge badge--ok">연결됨</span>
            <Link href={`/dashboard/${item.id}`} className="btn btn--ghost btn--sm">
              대시보드 보기
            </Link>
          </>
        )}
        {item.status === "accepted" && item.direction === "received" && (
          <span className="badge badge--ok">내 기록 열람 허용됨</span>
        )}
        {item.status === "rejected" && <span className="badge badge--muted">거절됨</span>}
        {item.status === "revoked" && <span className="badge badge--muted">연결 해제됨</span>}
      </div>
    </div>
  );
}
