import path from "node:path";

const loadEnvFromFile = (): void => {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
};

export const getNexusApiKey = (): string => {
  loadEnvFromFile();
  const apiKey = process.env.NEXUS_MODS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("NEXUS_MODS_API_KEY is not configured in the root .env file.");
  }

  return apiKey;
};
