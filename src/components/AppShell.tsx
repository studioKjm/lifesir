// 인증된 페이지 공용 데스크톱 쉘 — 왼쪽 사이드바 (2026-09-26 "토스 모던" 확정으로
// 상단 바에서 전환). 좁은 화면에서는 같은 사이드바가 상단 바로 접힌다.
import Link from "next/link";
import { logoutAction } from "@/app/_lib/auth-actions";
import styles from "./AppShell.module.css";

const BASE_NAV_ITEMS = [
  { key: "dashboard", href: "/dashboard", label: "대시보드" },
  { key: "care-links", href: "/care-links", label: "케어링크" },
  { key: "chat", href: "/chat", label: "AI 상담" },
  // seed-v3, AC-009 — 이전 라운드(AC-002/006/008)마다 "AC-009에서 결정"으로
  // 미뤄뒀던 항목. 구독 중인 유저가 상태 확인/해지하러 가는 경로가 /chat 차단
  // 배너 말곤 전무했던 문제를 해소한다(Navigator Plan A).
  { key: "subscription", href: "/subscription", label: "구독" },
] as const;

export type NavKey = (typeof BASE_NAV_ITEMS)[number]["key"] | "admin";

/**
 * (seed-v4, T-029, AC-001) isAdmin일 때만 "관리자" 링크를 끝에 추가한다 —
 * 비관리자에게는 존재 자체를 노출하지 않는다. GEN-007: 게이트(AC-008)만 있고
 * 클릭해서 도달할 진입점이 없으면 미완성이라, /admin 페이지 자체가 아니라
 * 평소 진입 동선(대시보드 등)에서도 보여야 한다.
 */
function buildNavItems(isAdmin: boolean) {
  return isAdmin ? [...BASE_NAV_ITEMS, { key: "admin" as const, href: "/admin", label: "관리자" }] : BASE_NAV_ITEMS;
}

export interface AppShellProps {
  active: NavKey;
  user: { name: string };
  isAdmin?: boolean;
  children: React.ReactNode;
}

function NavIcon({ navKey }: { navKey: NavKey }) {
  const paths: Record<NavKey, string> = {
    dashboard: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z",
    "care-links": "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    chat: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
    subscription: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h3",
    admin: "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z",
  };
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[navKey]} />
    </svg>
  );
}

export function AppShell({ active, user, isAdmin = false, children }: AppShellProps) {
  const navItems = buildNavItems(isAdmin);
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>동</span>
          동행
        </Link>
        <nav className={styles.nav} aria-label="주요 메뉴">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={item.key === active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              aria-current={item.key === active ? "page" : undefined}
            >
              <NavIcon navKey={item.key} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">
            {user.name.slice(0, 1)}
          </span>
          <span className={styles.userName}>{user.name}님</span>
          <form action={logoutAction}>
            <button type="submit" className={styles.logout}>
              로그아웃
            </button>
          </form>
        </div>
      </aside>
      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}

/**
 * 각 라우트 loading.tsx 공용 — 서버 응답을 기다리는 동안 쉘 모양을 먼저 보여준다
 * (2026-10-03, 페이지 이동 지연 개선). 동적 라우트는 loading.tsx가 있어야 Link가
 * 이 화면까지 미리 받아두고(부분 프리페치) 클릭 즉시 전환된다. 세션을 모르므로
 * 이름·관리자 메뉴는 그리지 않는다.
 */
export function ShellSkeleton({ active }: { active: NavKey }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>동</span>
          동행
        </Link>
        <nav className={styles.nav} aria-label="주요 메뉴">
          {buildNavItems(active === "admin").map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={item.key === active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              aria-current={item.key === active ? "page" : undefined}
            >
              <NavIcon navKey={item.key} />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className={styles.main} aria-busy="true">
        <div className={styles.content}>
          <span className={styles.srOnly}>불러오는 중</span>
          <div className={styles.skelTitle} />
          <div className={styles.skelRow}>
            <div className={styles.skelCard} />
            <div className={styles.skelCard} />
            <div className={styles.skelCard} />
          </div>
          <div className={styles.skelPanel} />
        </div>
      </main>
    </div>
  );
}
