import { spawn } from "node:child_process";

export interface PsResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const quotePsString = (value: string): string => value.replaceAll("'", "''");

export async function runPs(command: string, timeoutMs = 10_000): Promise<PsResult> {
  return await new Promise<PsResult>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`PowerShell command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const normalizedExitCode = exitCode ?? -1;
      const result: PsResult = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: normalizedExitCode,
      };

      if (normalizedExitCode !== 0) {
        reject(new Error(result.stderr || result.stdout || `PowerShell exited with code ${normalizedExitCode}`));
        return;
      }

      resolve(result);
    });
  });
}
