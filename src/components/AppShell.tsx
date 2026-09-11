// 인증된 페이지 공용 데스크톱 쉘 — 상단 네비게이션 바 (모바일 하단 탭바 대신
// 웹 우선으로 확장, 2026-09-11 사용자 지시).
import Link from "next/link";
import { logoutAction } from "@/app/_lib/auth-actions";
import styles from "./AppShell.module.css";

const NAV_ITEMS = [
  { key: "dashboard", href: "/dashboard", label: "대시보드" },
  { key: "care-links", href: "/care-links", label: "케어링크" },
  { key: "chat", href: "/chat", label: "AI 상담" },
] as const;

export interface AppShellProps {
  active: (typeof NAV_ITEMS)[number]["key"];
  user: { name: string };
  children: React.ReactNode;
}

export function AppShell({ active, user, children }: AppShellProps) {
  return (
    <>
      <header className={styles.header}>
        <div className={`container ${styles.bar}`}>
          <Link href="/dashboard" className={styles.brand}>
            <span className={styles.brandMark}>동</span>
            동행
          </Link>
          <nav className={styles.nav} aria-label="주요 메뉴">
            {NAV_ITEMS.map((item) => (
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
