const fs = require("fs");
const target = "packages/memory-db/src/database/intelligence.ts";
const buf = fs.readFileSync(target);
const sentinel = String.fromCharCode(0);
const escape = "\\u0000"; // 6 chars: backslash u 0 0 0 0
const text = buf.toString("utf8");
const next = text.split(sentinel).join(escape);
fs.writeFileSync(target, next);
const after = fs.readFileSync(target);
let nuls = 0;
for (const b of after) if (b === 0) nuls++;
console.log("NUL bytes after:", nuls);
console.log("Bytes:", after.length);
