export interface IpcSessionTracker {
  activeAssistantMessageId: string | null;
  backendGeneration: number | null;
  lastAutoSpokenMessageId: string | null;
  toolCallMessageIds: Map<string, string>;
}

export const createIpcSessionTracker = (): IpcSessionTracker => ({
  activeAssistantMessageId: null,
  backendGeneration: null,
  lastAutoSpokenMessageId: null,
  toolCallMessageIds: new Map<string, string>(),
});
