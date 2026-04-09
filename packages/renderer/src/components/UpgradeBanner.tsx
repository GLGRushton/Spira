import { useEffect, useState } from "react";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import styles from "./UpgradeBanner.module.css";

const formatUpgradeError = (error: unknown): string =>
  error instanceof Error ? error.message : "Failed to respond to the upgrade prompt.";

export function UpgradeBanner() {
  const banner = useUpgradeStore((store) => store.banner);
  const protocolBanner = useUpgradeStore((store) => store.protocolBanner);
  const clearBanner = useUpgradeStore((store) => store.clearBanner);
  const clearProtocolMismatch = useUpgradeStore((store) => store.clearProtocolMismatch);
  const setBanner = useUpgradeStore((store) => store.setBanner);
  const visibleBanner = banner ?? protocolBanner;
  const [responding, setResponding] = useState(false);
  const visibleBannerKey = `${visibleBanner?.proposalId ?? "none"}:${visibleBanner?.title ?? ""}:${visibleBanner?.message ?? ""}`;

  useEffect(() => {
    if (visibleBannerKey.length === 0) {
      return;
    }
    setResponding(false);
  }, [visibleBannerKey]);

  if (!visibleBanner) {
    return null;
  }

  const clearVisibleBanner = banner ? clearBanner : clearProtocolMismatch;
  const respondToProposal = async (approved: boolean) => {
    if (!visibleBanner.proposalId || responding) {
      return;
    }

    setResponding(true);
    try {
      await window.electronAPI.respondToUpgradeProposal(visibleBanner.proposalId, approved);
    } catch (error) {
      setBanner({
        kind: "error",
        title: "Upgrade response failed",
        message: formatUpgradeError(error),
        dismissible: true,
      });
    } finally {
      setResponding(false);
    }
  };

  const dismissVisibleBanner = () => {
    if (visibleBanner.proposalId) {
      void respondToProposal(false);
      return;
    }
    clearVisibleBanner();
  };
  const handleApprove = () => {
    void respondToProposal(true);
  };
  const handleDeny = () => {
    if (visibleBanner.proposalId) {
      void respondToProposal(false);
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
              disabled={responding}
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
              <button
                type="button"
                className={`${styles.button} ${responding ? styles.buttonBusy : ""}`}
                disabled={responding}
                aria-busy={responding}
                onClick={handleDeny}
              >
                {visibleBanner.secondaryActionLabel}
              </button>
            ) : null}
            {visibleBanner.primaryActionLabel ? (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary} ${responding ? styles.buttonBusy : ""}`}
                disabled={responding}
                aria-busy={responding}
                onClick={handleApprove}
              >
                {visibleBanner.primaryActionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </output>
  );
}
