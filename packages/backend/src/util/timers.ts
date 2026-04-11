export const setUnrefTimeout = (callback: () => void, delayMs: number): NodeJS.Timeout => {
  const timeout = setTimeout(callback, delayMs);
  timeout.unref?.();
  return timeout;
};
