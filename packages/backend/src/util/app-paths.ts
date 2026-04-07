import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

export const appRootDir = path.resolve(currentDir, "../../../..");

export const resolveAppPath = (filePath: string): string => {
  return path.isAbsolute(filePath) ? filePath : path.resolve(appRootDir, filePath);
};
