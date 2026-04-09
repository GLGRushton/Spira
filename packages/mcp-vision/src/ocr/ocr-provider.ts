import { type OcrResult, buildWindowsOcrScript } from "@spira/shared";
import { runPs } from "../util/powershell.js";

export interface IOcrProvider {
  recognize(imagePath: string): Promise<OcrResult>;
}

export class WindowsOcrProvider implements IOcrProvider {
  async recognize(imagePath: string): Promise<OcrResult> {
    const { stdout } = await runPs(buildWindowsOcrScript(imagePath), 20_000);
    return JSON.parse(stdout) as OcrResult;
  }
}
