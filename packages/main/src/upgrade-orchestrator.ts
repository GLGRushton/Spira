import type { ConnectionStatus, ServerMessage, UpgradeProposal } from "@spira/shared";
import type { BrowserWindow } from "electron";
import type { BackendLifecycle } from "./backend-lifecycle.js";

interface UpgradeOrchestratorOptions {
  lifecycle: BackendLifecycle;
  getWindow: () => BrowserWindow | null;
  emitConnectionStatus: (status: ConnectionStatus) => void;
}

interface ProposalDecision {
  accepted: boolean;
  reason?: string;
}

export class UpgradeOrchestrator {
  private pendingProposal: UpgradeProposal | null = null;
  private backendReloadInProgress = false;
  private uiRefreshInProgress = false;

  constructor(private readonly options: UpgradeOrchestratorOptions) {}

  handleProposal(proposal: UpgradeProposal): ProposalDecision {
    if (this.backendReloadInProgress) {
      return {
        accepted: false,
        reason: "A backend restart is already in progress.",
      };
    }

    if (this.uiRefreshInProgress) {
      return {
        accepted: false,
        reason: "A UI refresh is already in progress.",
      };
    }

    if (this.pendingProposal) {
      return {
        accepted: false,
        reason: "Another upgrade is already waiting for approval.",
      };
    }

    this.pendingProposal = proposal;
    this.send({
      type: "upgrade:proposal",
      proposal,
      message: this.describeProposal(proposal),
    });
    return { accepted: true };
  }

  async respondToProposal(proposalId: string, approved: boolean): Promise<void> {
    if (!this.pendingProposal || this.pendingProposal.proposalId !== proposalId) {
      return;
    }

    const proposal = this.pendingProposal;
    this.pendingProposal = null;

    if (!approved) {
      this.send({
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "denied",
        message: "Upgrade left unapplied.",
      });
      return;
    }

    switch (proposal.scope) {
      case "backend-reload":
        await this.applyBackendReload(proposal);
        return;
      case "ui-refresh":
        this.applyUiRefresh(proposal);
        return;
      case "full-restart":
        this.send({
          type: "upgrade:status",
          proposalId: proposal.proposalId,
          scope: proposal.scope,
          status: "manual-restart",
          message: "This upgrade still needs a full manual restart of Spira.",
        });
        return;
      case "hot-capability":
        this.send({
          type: "upgrade:status",
          proposalId: proposal.proposalId,
          scope: proposal.scope,
          status: "failed",
          message: "Hot capability upgrades should be applied directly instead of queued as restart proposals.",
        });
        return;
      default:
        return;
    }
  }

  private applyUiRefresh(proposal: UpgradeProposal): void {
    this.send({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "applying",
      message: "Refreshing the UI to apply the update...",
    });

    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) {
      this.send({
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "failed",
        message: "Unable to refresh the UI because the main window is unavailable.",
      });
      return;
    }

    this.uiRefreshInProgress = true;
    const clearRefreshState = () => {
      this.uiRefreshInProgress = false;
      window.webContents.removeListener("did-finish-load", handleRefreshSuccess);
      window.webContents.removeListener("did-fail-load", handleRefreshFailure);
      window.webContents.removeListener("destroyed", handleRefreshDestroyed);
    };

    const handleRefreshSuccess = () => {
      clearRefreshState();
    };
    const handleRefreshFailure = () => {
      clearRefreshState();
      this.send({
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "failed",
        message: "UI refresh failed. Please try again.",
      });
    };
    const handleRefreshDestroyed = () => {
      clearRefreshState();
    };

    window.webContents.once("did-finish-load", handleRefreshSuccess);
    window.webContents.once("did-fail-load", handleRefreshFailure);
    window.webContents.once("destroyed", handleRefreshDestroyed);
    window.webContents.reload();
  }

  isRestartInProgress(): boolean {
    return this.backendReloadInProgress;
  }

  clearPendingProposal(): void {
    this.pendingProposal = null;
  }

  private async applyBackendReload(proposal: UpgradeProposal): Promise<void> {
    this.send({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "applying",
      message: "Restarting the backend to apply the upgrade...",
    });
    this.backendReloadInProgress = true;
    this.options.emitConnectionStatus("upgrading");

    try {
      await this.options.lifecycle.restart();
      this.send({
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "completed",
        message: "Backend upgrade applied.",
      });
    } catch (error) {
      this.send({
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "failed",
        message: error instanceof Error ? error.message : "Backend restart failed.",
      });
    } finally {
      this.backendReloadInProgress = false;
    }
  }

  private send(message: ServerMessage): void {
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send("spira:from-backend", message);
  }

  private describeProposal(proposal: UpgradeProposal): string {
    switch (proposal.scope) {
      case "backend-reload":
        return "This change needs a brief backend restart to take effect. Approve when you're ready.";
      case "ui-refresh":
        return "This change needs a UI refresh to take effect. Refresh when you're ready; the chat history will be restored.";
      case "full-restart":
        return "This change needs a full app restart to take effect.";
      case "hot-capability":
        return "This change should be applied immediately without a restart proposal.";
      default:
        return proposal.summary;
    }
  }
}
