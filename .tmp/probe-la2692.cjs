const Database = require("C:/GitHub/Spira/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3");
const db = new Database(process.env.TEMP + "/spira-readonly.db", { readonly: true });

const runs = db.prepare("SELECT run_id, ticket_id, project_key, status, mission_phase, status_message, created_at, updated_at FROM ticket_runs WHERE ticket_id = ? ORDER BY created_at DESC").all("LA-2692");
console.log("RUNS:");
console.log(JSON.stringify(runs, null, 2));

if (runs.length === 0) {
  // Try fuzzy
  const fuzzy = db.prepare("SELECT run_id, ticket_id, project_key, status, mission_phase, created_at, updated_at FROM ticket_runs WHERE ticket_id LIKE ? ORDER BY created_at DESC LIMIT 10").all("%2692%");
  console.log("FUZZY:");
  console.log(JSON.stringify(fuzzy, null, 2));
  // Show most recent runs to find the right one
  const recent = db.prepare("SELECT run_id, ticket_id, project_key, status, mission_phase, created_at, updated_at FROM ticket_runs ORDER BY created_at DESC LIMIT 10").all();
  console.log("RECENT:");
  console.log(JSON.stringify(recent, null, 2));
}
