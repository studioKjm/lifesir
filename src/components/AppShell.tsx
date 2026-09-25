// 인증된 페이지 공용 데스크톱 쉘 — 상단 네비게이션 바 (모바일 하단 탭바 대신
// 웹 우선으로 확장, 2026-09-11 사용자 지시).
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

export function AppShell({ active, user, isAdmin = false, children }: AppShellProps) {
  const navItems = buildNavItems(isAdmin);
  return (
    <>
      <header className={styles.header}>
        <div className={`container ${styles.bar}`}>
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
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.right}>
            <span className={styles.userName}>{user.name}님</span>
            <span className={styles.avatar} aria-hidden="true">
              {user.name.slice(0, 1)}
            </span>
            <form action={logoutAction}>
              <button type="submit" className="btn btn--ghost btn--sm">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className={`container ${styles.main}`}>{children}</main>
    </>
  );
}
