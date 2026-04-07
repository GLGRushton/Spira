import { tsImport } from "tsx/esm/api";

process.env.NODE_ENV ??= "development";

await tsImport("./src/index.ts", import.meta.url);
