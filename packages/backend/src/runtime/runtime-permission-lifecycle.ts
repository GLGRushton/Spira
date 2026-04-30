import type { PermissionRequestPayload } from "@spira/shared";
import type { ProviderPermissionResult } from "../provider/types.js";
import {
  recordRuntimePermissionRequested,
  recordRuntimePermissionResolved,
  toRuntimePermissionResolutionStatus,
} from "./runtime-lifecycle.js";
import type { RuntimeStore } from "./runtime-store.js";

export const executeRuntimePermissionRequest = async (input: {
  runtimeStore: RuntimeStore | null | undefined;
  runtimeSessionId: string | null;
  payload: PermissionRequestPayload;
  now: () => number;
  onRequested?: (payload: PermissionRequestPayload) => void;
  onResolved?: (status: "approved" | "denied" | "expired") => void;
  decide: () => Promise<ProviderPermissionResult>;
}): Promise<ProviderPermissionResult> => {
  input.onRequested?.(input.payload);
  recordRuntimePermissionRequested(input.runtimeStore, input.runtimeSessionId, input.payload, input.now());
  const result = await input.decide();
  const status = toRuntimePermissionResolutionStatus(result);
  input.onResolved?.(status);
  recordRuntimePermissionResolved(input.runtimeStore, input.runtimeSessionId, {
    requestId: input.payload.requestId,
    status,
    occurredAt: input.now(),
  });
  return result;
};
