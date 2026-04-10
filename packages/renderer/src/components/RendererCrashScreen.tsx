import type { RendererFatalPayload } from "@spira/shared";
import styles from "./RendererCrashScreen.module.css";

interface RendererCrashScreenProps {
  fatal: RendererFatalPayload;
}

export function RendererCrashScreen({ fatal }: RendererCrashScreenProps) {
  return (
    <div className={styles.screen}>
      <section className={styles.panel} role="alert" aria-live="assertive">
        <span className={styles.eyebrow}>Spira renderer</span>
        <h1 className={styles.title}>{fatal.title}</h1>
        <p className={styles.message}>{fatal.message} Reload Spira to try again.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.reloadButton} onClick={() => window.location.reload()}>
            Reload Spira
          </button>
        </div>
        {fatal.details ? (
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>Technical details</summary>
            <pre className={styles.detailsBody}>{fatal.details}</pre>
          </details>
        ) : null}
      </section>
    </div>
  );
}
