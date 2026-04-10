import {
  type ConnectionStatus,
  type ServerMessage,
  type UpgradeProposal,
  upgradeCanAutoRelaunch,
  upgradeNeedsUiRefresh,
} from "@spira/shared";
import type { BrowserWindow, Event as ElectronEvent } from "electron";
import type { BackendLifecycle } from "./backend-lifecycle.js";

interface UpgradeOrchestratorOptions {
  lifecycle: BackendLifecycle;
  getWindow: () => BrowserWindow | null;
  emitConnectionStatus: (status: ConnectionStatus) => void;
  getRendererReadySequence: () => number;
  waitForNextRendererReady: (afterSequence: number, timeoutMs: number) => Promise<void>;
  relaunchApp: () => Promise<void>;
}

interface ProposalDecision {
  accepted: boolean;
  reason?: string;
}

class ReportedUpgradeError extends Error {}

const UI_REFRESH_READY_TIMEOUT_MS = 15_000;

export class UpgradeOrchestrator {
  private pendingProposal: UpgradeProposal | null = null;
  private backendReloadInProgress = false;
  private appRelaunchInProgress = false;
  private uiRefreshInProgress = false;

  constructor(private readonly options: UpgradeOrchestratorOptions) {}

  handleProposal(proposal: UpgradeProposal): ProposalDecision {
    if (this.appRelaunchInProgress) {
      return {
        accepted: false,
        reason: "An app relaunch is already in progress.",
      };
    }

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
      throw new Error("This upgrade prompt is no longer active.");
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
        await this.applyUiRefresh(proposal, {
          applyingMessage: "Refreshing the UI to apply the update...",
          completedMessage: "Upgrade applied.",
        });
        return;
      case "full-restart":
        if (upgradeCanAutoRelaunch(proposal.changedFiles)) {
          await this.applyAppRelaunch(proposal);
          return;
        }

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

  private async applyUiRefresh(
    proposal: UpgradeProposal,
    options: { applyingMessage: string; completedMessage: string },
  ): Promise<void> {
    this.send({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "applying",
      message: options.applyingMessage,
    });

    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) {
      throw this.failUpgrade(proposal, "Unable to refresh the UI because the main window is unavailable.");
    }

    this.uiRefreshInProgress = true;
    try {
      const rendererReadySequence = this.options.getRendererReadySequence();
      await new Promise<void>((resolve, reject) => {
        const clearRefreshState = () => {
          window.webContents.removeListener("did-fail-load", handleRefreshFailure);
          window.webContents.removeListener("destroyed", handleRefreshDestroyed);
        };

        const handleRefreshSuccess = () => {
          clearRefreshState();
          this.send({
            type: "upgrade:status",
            proposalId: proposal.proposalId,
            scope: proposal.scope,
            status: "completed",
            message: options.completedMessage,
          });
          resolve();
        };
        const handleRefreshFailure = (
          _event: ElectronEvent,
          _errorCode: number,
          _errorDescription: string,
          _validatedUrl: string,
          isMainFrame: boolean,
        ) => {
          if (!isMainFrame) {
            return;
          }

          clearRefreshState();
          reject(this.failUpgrade(proposal, "UI refresh failed. Please try again."));
        };
        const handleRefreshDestroyed = () => {
          clearRefreshState();
          reject(this.failUpgrade(proposal, "The main window closed before the UI refresh completed."));
        };

        window.webContents.on("did-fail-load", handleRefreshFailure);
        window.webContents.once("destroyed", handleRefreshDestroyed);
        void this.options
          .waitForNextRendererReady(rendererReadySequence, UI_REFRESH_READY_TIMEOUT_MS)
          .then(handleRefreshSuccess)
          .catch((error: unknown) => {
            clearRefreshState();
            reject(
              this.failUpgrade(
                proposal,
                error instanceof Error ? error.message : "Timed out waiting for the UI to finish loading.",
              ),
            );
          });
        window.webContents.reloadIgnoringCache();
      });
    } finally {
      this.uiRefreshInProgress = false;
    }
  }

  isRestartInProgress(): boolean {
    return this.backendReloadInProgress || this.appRelaunchInProgress;
  }

  clearPendingProposal(): void {
    this.pendingProposal = null;
  }

  reemitPendingProposal(): void {
    if (!this.pendingProposal) {
      return;
    }

    this.send({
      type: "upgrade:proposal",
      proposal: this.pendingProposal,
      message: this.describeProposal(this.pendingProposal),
    });
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
      if (upgradeNeedsUiRefresh(proposal.changedFiles)) {
        await this.applyUiRefresh(proposal, {
          applyingMessage: "Backend restarted. Refreshing the UI to finish the upgrade...",
          completedMessage: "Upgrade applied.",
        });
      } else {
        this.send({
          type: "upgrade:status",
          proposalId: proposal.proposalId,
          scope: proposal.scope,
          status: "completed",
          message: "Backend upgrade applied.",
        });
      }
    } catch (error) {
      if (!(error instanceof ReportedUpgradeError)) {
        this.failUpgrade(proposal, error instanceof Error ? error.message : "Backend restart failed.");
      }
    } finally {
      this.backendReloadInProgress = false;
    }
  }

  private async applyAppRelaunch(proposal: UpgradeProposal): Promise<void> {
    this.send({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "applying",
      message: "Restarting Spira to apply the upgrade...",
    });
    this.appRelaunchInProgress = true;
    this.options.emitConnectionStatus("upgrading");

    try {
      await this.options.relaunchApp();
    } catch (error) {
      this.failUpgrade(proposal, error instanceof Error ? error.message : "Failed to relaunch Spira.");
      this.appRelaunchInProgress = false;
    }
  }

  private failUpgrade(proposal: UpgradeProposal, message: string): Error {
    this.send({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "failed",
      message,
    });
    return new ReportedUpgradeError(message);
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
        return upgradeNeedsUiRefresh(proposal.changedFiles)
          ? "This change needs a brief backend restart and UI refresh. Approve when you're ready."
          : "This change needs a brief backend restart to take effect. Approve when you're ready.";
      case "ui-refresh":
        return "This change needs a UI refresh to take effect. Refresh when you're ready; the chat history will be restored.";
      case "full-restart":
        return upgradeCanAutoRelaunch(proposal.changedFiles)
          ? "This change needs Spira to relaunch to take effect. Approve when you're ready."
          : "This change still needs a manual restart of Spira to take effect.";
      case "hot-capability":
        return "This change should be applied immediately without a restart proposal.";
      default:
        return proposal.summary;
    }
  }
}
