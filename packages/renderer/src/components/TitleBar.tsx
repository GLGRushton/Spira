import { ConnectionDot } from "./ConnectionDot.js";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  return (
    <header className={styles.titleBar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true">
          <span className={styles.brandCore} />
          <span className={`${styles.brandMote} ${styles.brandMoteA}`} />
          <span className={`${styles.brandMote} ${styles.brandMoteB}`} />
          <span className={`${styles.brandMote} ${styles.brandMoteC}`} />
        </div>
        <div>
          <div className={styles.logo}>Spira</div>
          <div className={styles.subtitle}>Shinra command interface</div>
        </div>
        <div className={styles.brandDivider} aria-hidden="true" />
        <ConnectionDot />
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => window.electronAPI.minimize()}
          aria-label="Minimize"
        >
          —
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => window.electronAPI.maximize()}
          aria-label="Maximize"
        >
          ▢
        </button>
        <button
          type="button"
          className={`${styles.controlButton} ${styles.closeButton}`}
          onClick={() => window.electronAPI.close()}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
