import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import styles from "./page.module.css";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className={styles.hero}>
      <div className={styles.wrap}>
        <div>
          <span className={styles.eyebrow}>가족 건강 케어</span>
          <h1 className={styles.title}>
            부모와 자녀가
            <br />
            <em>동의</em>로 이어지는 건강 기록
          </h1>
          <p className={styles.desc}>
            운동, 수면, 체중, 식사, 복약을 하루하루 기록하고 연령대에 맞춰 다르게 답하는 AI 코치와 대화하세요.
            자녀는 부모가 연결을 수락한 경우에만 건강 기록을 확인할 수 있어요.
          </p>
          <div className={styles.ctaRow}>
            <Link href="/signup" className="btn btn--primary">
              무료로 시작하기
            </Link>
            <Link href="/login" className="btn btn--ghost">
              로그인
            </Link>
          </div>
        </div>
        <div className={styles.preview} aria-hidden="true">
          <p className={styles.previewLabel}>오늘의 체중</p>
          <p className={styles.previewValue}>
            58.2<small style={{ fontSize: 18 }}>kg</small>
          </p>
          <div className={styles.previewRow}>
            <div className={styles.previewTile}>
              <p className={styles.previewTileLabel}>운동</p>
              <p className={styles.previewTileValue}>30분</p>
            </div>
            <div className={styles.previewTile}>
              <p className={styles.previewTileLabel}>수면</p>
              <p className={styles.previewTileValue}>7.2시간</p>
            </div>
            <div className={styles.previewTile}>
              <p className={styles.previewTileLabel}>복약</p>
              <p className={styles.previewTileValue}>완료</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
