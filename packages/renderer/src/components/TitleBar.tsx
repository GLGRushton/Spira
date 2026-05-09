import { ConnectionDot } from "./ConnectionDot.js";
import { YevonSpiral } from "./decor/Glyphs.js";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  return (
    <header className={styles.titleBar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true">
          <YevonSpiral size={20} color="var(--gold-bright)" strokeWidth={1.4} />
        </div>
        <div className={styles.brandText}>
          <div className={styles.logo}>SPIRA</div>
          <div className={styles.subtitle}>Shinra · Cloister</div>
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
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => window.electronAPI.maximize()}
          aria-label="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.controlButton} ${styles.closeButton}`}
          onClick={() => window.electronAPI.close()}
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
