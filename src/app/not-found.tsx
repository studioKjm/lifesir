// 2026-09-19(QA) — 존재하지 않는 경로(예: 삭제된/잘못된 케어링크 id)로 들어오면
// 세션 유무와 무관하게 이 파일이 항상 렌더링된다(Next.js 컨벤션상 not-found.tsx는
// 세션을 요구하는 AppShell과 달리 인증 여부에 의존할 수 없다). 커스텀 파일이
// 없으면 Next.js 기본 404(브랜드/테마 없는 흰 배경 텍스트)가 그대로 노출되던
// 문제를 고친다 — (auth)/layout.tsx와 동일한 "중앙 정렬 브랜드 패널" 컨벤션을
// 재사용해 나머지 화면과 톤을 맞춘다.
import Link from "next/link";
import styles from "./(auth)/AuthLayout.module.css";

export default function NotFound() {
  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>동</span>
          동행
        </Link>
        <div className="card" style={{ textAlign: "center" }}>
          <h1 className="page-title" style={{ fontSize: 22 }}>
            페이지를 찾을 수 없어요
          </h1>
          <p className="page-subtitle" style={{ marginBottom: 24 }}>
            주소가 잘못됐거나 더 이상 존재하지 않는 페이지예요.
          </p>
          <Link href="/dashboard" className="btn btn--primary btn--block">
            대시보드로 가기
          </Link>
        </div>
      </div>
    </div>
  );
}
