import type { ProviderPermissionResult } from "../provider/types.js";

export const approvePermissionOnce = (): ProviderPermissionResult => ({ kind: "approve-once" });

export const rejectPermission = (feedback?: string): ProviderPermissionResult => {
  const normalizedFeedback = feedback?.trim();
  return normalizedFeedback ? { kind: "reject", feedback: normalizedFeedback } : { kind: "reject" };
};

export const permissionUserNotAvailable = (): ProviderPermissionResult => ({ kind: "user-not-available" });
