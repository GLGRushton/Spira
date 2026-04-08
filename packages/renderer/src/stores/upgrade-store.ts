import type { UpgradeProposal, UpgradeScope, UpgradeStatus } from "@spira/shared";
import { create } from "zustand";

export interface UpgradeBannerState {
  kind: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  proposalId?: string;
  scope?: UpgradeScope;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  dismissible?: boolean;
}

interface UpgradeStore {
  banner: UpgradeBannerState | null;
  protocolBanner: UpgradeBannerState | null;
  setBanner: (banner: UpgradeBannerState | null) => void;
  clearBanner: () => void;
  setProtocolMismatch: (backendProtocolVersion: number, backendBuildId: string) => void;
  clearProtocolMismatch: () => void;
  showProposal: (proposal: UpgradeProposal, message: string) => void;
  showStatus: (status: UpgradeStatus) => void;
}

const getPrimaryActionLabel = (scope: UpgradeScope): string | undefined => {
  switch (scope) {
    case "backend-reload":
      return "Apply now";
    case "ui-refresh":
      return "Refresh now";
    case "full-restart":
      return "I'll restart manually";
    case "hot-capability":
      return undefined;
    default:
      return undefined;
  }
};

export const useUpgradeStore = create<UpgradeStore>((set) => ({
  banner: null,
  protocolBanner: null,
  setBanner: (banner) => {
    set({ banner });
  },
  clearBanner: () => {
    set({ banner: null });
  },
  setProtocolMismatch: (backendProtocolVersion, backendBuildId) => {
    set({
      protocolBanner: {
        kind: "warning",
        title: "Spira update available",
        message: `Renderer protocol mismatch detected (backend v${backendProtocolVersion}, build ${backendBuildId}). Refresh the UI to reconnect cleanly.`,
        dismissible: true,
      },
    });
  },
  clearProtocolMismatch: () => {
    set({ protocolBanner: null });
  },
  showProposal: (proposal, message) => {
    const primaryActionLabel = getPrimaryActionLabel(proposal.scope);
    set({
      banner: {
        kind: proposal.scope === "backend-reload" ? "warning" : "info",
        title: proposal.summary,
        message,
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        primaryActionLabel,
        secondaryActionLabel: primaryActionLabel ? "Not now" : undefined,
        dismissible: !primaryActionLabel,
      },
    });
  },
  showStatus: (status) => {
    if (status.status === "denied") {
      set({
        banner: {
          kind: "info",
          title: "Upgrade deferred",
          message: status.message,
          dismissible: true,
        },
      });
      return;
    }

    if (status.status === "completed") {
      set({
        banner: {
          kind: "success",
          title: "Upgrade applied",
          message: status.message,
          dismissible: true,
        },
      });
      return;
    }

    if (status.status === "manual-restart") {
      set({
        banner: {
          kind: "warning",
          title: "Manual restart required",
          message: status.message,
          dismissible: true,
        },
      });
      return;
    }

    if (status.status === "failed") {
      set({
        banner: {
          kind: "error",
          title: "Upgrade failed",
          message: status.message,
          dismissible: true,
        },
      });
      return;
    }

    set({
      banner: {
        kind: "info",
        title: "Applying upgrade",
        message: status.message,
        scope: status.scope,
        dismissible: false,
      },
    });
  },
}));
