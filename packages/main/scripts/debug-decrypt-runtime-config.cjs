// One-shot Electron script: loads the runtime-config JSON and decrypts each key
// via safeStorage, printing what `getRuntimeConfigSummary` would see.
//
//   pnpm -F @spira/main exec electron packages/main/scripts/debug-decrypt-runtime-config.cjs
//
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(() => {
  const filePath = path.join(app.getPath("userData"), "spira-runtime-config.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  console.log(`# safeStorage.isEncryptionAvailable = ${safeStorage.isEncryptionAvailable()}`);
  console.log(`# file = ${filePath}`);
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      console.log(`${key}: <cleared>`);
      continue;
    }
    if (typeof value !== "string") {
      console.log(`${key}: <non-string ${typeof value}>`);
      continue;
    }
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(value, "base64"));
      console.log(`${key}: OK len=${decrypted.length} preview=${JSON.stringify(decrypted.slice(0, 60))}`);
    } catch (error) {
      console.log(`${key}: DECRYPT FAILED — ${error.message}`);
    }
  }
  app.exit(0);
});
