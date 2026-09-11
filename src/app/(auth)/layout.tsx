import Link from "next/link";
import styles from "./AuthLayout.module.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>동</span>
          동행
        </Link>
        {children}
      </div>
    </div>
  );
}
