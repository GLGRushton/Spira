import { runPs } from "@spira/mcp-util/powershell";
import { type OcrResult, buildWindowsOcrScript } from "@spira/shared";

export async function recognizeWindowImage(imagePath: string): Promise<OcrResult> {
  const { stdout } = await runPs(buildWindowsOcrScript(imagePath), 20_000);
  return JSON.parse(stdout) as OcrResult;
}
