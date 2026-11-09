import Link from "next/link";

import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <section className={styles.wrap}>
      <p className={styles.code}>404</p>
      <h2>This page doesn&apos;t exist.</h2>
      <Link className={styles.link} href="/qc">
        Back to quality control
      </Link>
    </section>
  );
}
