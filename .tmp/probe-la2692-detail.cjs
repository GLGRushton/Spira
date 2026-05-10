const Database = require("C:/GitHub/Spira/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3");
const db = new Database(process.env.TEMP + "/spira-readonly.db", { readonly: true });

const RUN_ID = "30fec045-a6fd-4add-9498-5533b6e9bad8";

console.log("=== ATTEMPTS ===");
const attempts = db.prepare("SELECT attempt_id, sequence, status, started_at, completed_at, summary FROM ticket_run_attempts WHERE run_id = ? ORDER BY sequence ASC").all(RUN_ID);
console.log(`count=${attempts.length}`);
for (const a of attempts) {
  console.log(`  #${a.sequence} status=${a.status} started=${new Date(a.started_at).toISOString()} completed=${a.completed_at ? new Date(a.completed_at).toISOString() : 'NULL'} summary=${(a.summary||'').slice(0,80)}`);
}

console.log("\n=== EVENT TYPE COUNTS ===");
const counts = db.prepare("SELECT event_type, COUNT(*) as cnt FROM mission_events WHERE run_id = ? GROUP BY event_type ORDER BY cnt DESC").all(RUN_ID);
for (const c of counts) console.log(`  ${c.event_type.padEnd(40)} ${c.cnt}`);

console.log("\n=== PHASE TIMING (from mission_phase changes) ===");
// Collect every event with its stage to detect phase boundaries
const events = db.prepare("SELECT id, stage, event_type, occurred_at FROM mission_events WHERE run_id = ? ORDER BY occurred_at ASC, id ASC").all(RUN_ID);
let lastStage = null;
const phaseStarts = {};
const phaseEnds = {};
for (const e of events) {
  if (e.stage !== lastStage) {
    if (lastStage !== null) phaseEnds[lastStage] = e.occurred_at;
    if (!(e.stage in phaseStarts)) phaseStarts[e.stage] = e.occurred_at;
    lastStage = e.stage;
  }
}
if (lastStage !== null) phaseEnds[lastStage] = events[events.length-1].occurred_at;
const fmt = (ms) => {
  if (ms < 60000) return (ms/1000).toFixed(1) + "s";
  if (ms < 3600000) return Math.floor(ms/60000) + "m" + Math.floor((ms%60000)/1000) + "s";
  return Math.floor(ms/3600000) + "h" + Math.floor((ms%3600000)/60000) + "m";
};
for (const stage of Object.keys(phaseStarts)) {
  const dur = phaseEnds[stage] - phaseStarts[stage];
  console.log(`  ${stage.padEnd(15)} duration=${fmt(dur)} start=${new Date(phaseStarts[stage]).toISOString()} end=${new Date(phaseEnds[stage]).toISOString()}`);
}

console.log("\n=== TIMELINE GAPS > 60s ===");
let prevTime = null, prevEvent = null;
for (const e of events) {
  if (prevTime !== null) {
    const gap = e.occurred_at - prevTime;
    if (gap > 60000) {
      console.log(`  ${fmt(gap).padStart(8)} between ${prevEvent.stage}/${prevEvent.event_type} and ${e.stage}/${e.event_type} at ${new Date(e.occurred_at).toISOString()}`);
    }
  }
  prevTime = e.occurred_at;
  prevEvent = e;
}

console.log("\n=== MISSION PHASE TRANSITIONS (mission_phase column on attempts/events) ===");
// Pull each event with attempt_id + stage + event_type
const allEvents = db.prepare("SELECT id, attempt_id, stage, event_type, metadata_json, occurred_at FROM mission_events WHERE run_id = ? ORDER BY occurred_at ASC").all(RUN_ID);
console.log(`total events: ${allEvents.length}`);
const summaryEvents = allEvents.filter(e => e.event_type.includes('summary') || e.event_type.includes('summarise') || e.event_type.includes('classification') || e.event_type.includes('plan-saved') || e.event_type.includes('proof-finished') || e.event_type.includes('validation-recorded') || e.event_type.includes('mission-outcome') || e.event_type.includes('learned') || e.event_type.includes('candidate'));
for (const e of summaryEvents) {
  const meta = e.metadata_json ? JSON.parse(e.metadata_json) : {};
  console.log(`  ${new Date(e.occurred_at).toISOString()} [${e.stage}] ${e.event_type} meta=${JSON.stringify(meta).slice(0,200)}`);
}
