import { ConnectionDot } from "./ConnectionDot.js";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  return (
    <header className={styles.titleBar}>
      <div className={styles.brand}>
        <div>
          <div className={styles.logo}>Spira</div>
          <div className={styles.subtitle}>Powered by GitHub Copilot</div>
        </div>
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
