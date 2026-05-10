import type { TicketRunSummary } from "@spira/shared";
import { useEffect, useState } from "react";
import { useNavigationStore } from "../../../stores/navigation-store.js";
import styles from "./MissionDetailsRoom.module.css";

interface RepoProfileOnboardingBannerProps {
  run: TicketRunSummary;
}

/**
 * Soft prompt for the operator to capture a repo profile when one's missing for the
 * mission's projectKey. Dismissable per session; polls listMissionRepoProfiles once on
 * mount so we don't spam the bridge.
 */
export function RepoProfileOnboardingBanner({ run }: RepoProfileOnboardingBannerProps) {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const dismissed = useNavigationStore((store) =>
    run.projectKey ? store.dismissedRepoProfileProjectKeys.has(run.projectKey) : true,
  );
  const openOnboarding = useNavigationStore((store) => store.openRepoProfileOnboarding);
  const dismissOnboarding = useNavigationStore((store) => store.dismissRepoProfileOnboarding);

  useEffect(() => {
    let cancelled = false;
    if (!run.projectKey || dismissed) {
      setHasProfile(true);
      return;
    }
    const check = async () => {
      try {
        const snapshot = await window.electronAPI.listMissionRepoProfiles();
        if (cancelled) return;
        setHasProfile(snapshot.profiles.some((profile) => profile.projectKey === run.projectKey));
      } catch {
        if (!cancelled) setHasProfile(true); // fail closed — never block the operator
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [run.projectKey, dismissed]);

  if (!run.projectKey || dismissed || hasProfile !== false) return null;
  const projectKey = run.projectKey;

  return (
    <div className={styles.permissionBanner} role="status">
      <div className={styles.permissionBannerCopy}>
        <strong>We don't know much about {projectKey} yet</strong>
        <span>
          Capture the basics (default branch, registry, required SDKs) once and Spira will lean on
          it for every mission in this project.
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className={styles.permissionBannerAction}
          onClick={() => openOnboarding(projectKey)}
        >
          Capture profile
        </button>
        <button
          type="button"
          className={styles.permissionBannerAction}
          onClick={() => dismissOnboarding(projectKey)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
