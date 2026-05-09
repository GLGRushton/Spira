import styles from "./MacalaniaDrift.module.css";

export function MacalaniaDrift() {
  return (
    <div className={styles.drift} aria-hidden="true">
      <div className={`${styles.layer} ${styles.layerFar}`} />
      <div className={`${styles.layer} ${styles.layerMid}`} />
    </div>
  );
}
