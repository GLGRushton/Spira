import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const packagedResourcesRoot = process.env.SPIRA_RESOURCES_PATH
  ? path.join(process.env.SPIRA_RESOURCES_PATH, "app.asar.unpacked")
  : null;

export const appRootDir = path.resolve(currentDir, "../../../..");

export const resolveAppPath = (filePath: string): string => {
  return path.isAbsolute(filePath) ? filePath : path.resolve(appRootDir, filePath);
};

export const resolveUnpackedAppPath = (filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  if (packagedResourcesRoot) {
    return path.join(packagedResourcesRoot, filePath);
  }

  return path.resolve(appRootDir, filePath);
};
