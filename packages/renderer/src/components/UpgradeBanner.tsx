import { useUpgradeStore } from "../stores/upgrade-store.js";
import styles from "./UpgradeBanner.module.css";

export function UpgradeBanner() {
  const banner = useUpgradeStore((store) => store.banner);
  const protocolBanner = useUpgradeStore((store) => store.protocolBanner);
  const clearBanner = useUpgradeStore((store) => store.clearBanner);
  const clearProtocolMismatch = useUpgradeStore((store) => store.clearProtocolMismatch);
  const visibleBanner = banner ?? protocolBanner;

  if (!visibleBanner) {
    return null;
  }

  const clearVisibleBanner = banner ? clearBanner : clearProtocolMismatch;
  const dismissVisibleBanner = () => {
    if (visibleBanner.proposalId) {
      void window.electronAPI.respondToUpgradeProposal(visibleBanner.proposalId, false);
      return;
    }
    clearVisibleBanner();
  };
  const handleApprove = () => {
    if (!visibleBanner.proposalId) {
      return;
    }
    void window.electronAPI.respondToUpgradeProposal(visibleBanner.proposalId, true);
  };
  const handleDeny = () => {
    if (visibleBanner.proposalId) {
      void window.electronAPI.respondToUpgradeProposal(visibleBanner.proposalId, false);
      return;
    }
    clearVisibleBanner();
  };

  return (
    <output className={`${styles.banner} ${styles[visibleBanner.kind] ?? ""}`} aria-live="polite">
      <div className={styles.inner}>
        <div className={styles.header}>
          <strong className={styles.title}>{visibleBanner.title}</strong>
          {visibleBanner.dismissible !== false ? (
            <button
              type="button"
              className={styles.dismiss}
              aria-label="Dismiss upgrade notice"
              onClick={dismissVisibleBanner}
            >
              ×
            </button>
          ) : null}
        </div>
        <p className={styles.message}>{visibleBanner.message}</p>
        {visibleBanner.primaryActionLabel || visibleBanner.secondaryActionLabel ? (
          <div className={styles.actions}>
            {visibleBanner.secondaryActionLabel ? (
              <button type="button" className={styles.button} onClick={handleDeny}>
                {visibleBanner.secondaryActionLabel}
              </button>
            ) : null}
            {visibleBanner.primaryActionLabel ? (
              <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleApprove}>
                {visibleBanner.primaryActionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </output>
  );
}
