const Database = require("C:/GitHub/Spira/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3");
const db = new Database(process.env.TEMP + "/spira-readonly.db", { readonly: true });

const RUN_ID = "30fec045-a6fd-4add-9498-5533b6e9bad8";

console.log("=== LEARNING / OUTCOME EVENTS for LA-2692 ===");
const learn = db.prepare("SELECT id, stage, event_type, metadata_json, occurred_at FROM mission_events WHERE run_id = ? AND (event_type LIKE '%learned%' OR event_type LIKE '%candidate%' OR event_type LIKE '%outcome%' OR event_type LIKE 'mission-state%' OR event_type = 'run-closed' OR event_type LIKE 'repo-intelligence%' OR event_type LIKE 'validation-profile%') ORDER BY occurred_at ASC").all(RUN_ID);
console.log(`learning-related events: ${learn.length}`);
for (const e of learn) {
  const meta = e.metadata_json ? JSON.parse(e.metadata_json) : {};
  console.log(`  ${new Date(e.occurred_at).toISOString()} [${e.stage}] ${e.event_type}`);
  console.log(`    ${JSON.stringify(meta)}`);
}

console.log("\n=== PROJECT-WIDE LEARNING ACROSS ALL RUNS for LA project ===");
const allLearn = db.prepare("SELECT e.run_id, e.event_type, e.metadata_json, e.occurred_at FROM mission_events e INNER JOIN ticket_runs r ON r.run_id = e.run_id WHERE r.project_key = 'LA' AND (e.event_type LIKE '%learned%' OR e.event_type LIKE '%candidate%' OR e.event_type = 'mission-outcome-classified' OR e.event_type = 'validation-profile-auto-promoted') ORDER BY e.occurred_at DESC LIMIT 30").all();
console.log(`count: ${allLearn.length}`);
for (const e of allLearn) {
  const meta = e.metadata_json ? JSON.parse(e.metadata_json) : {};
  console.log(`  ${new Date(e.occurred_at).toISOString()} run=${e.run_id.slice(0,8)} ${e.event_type} ${JSON.stringify(meta).slice(0,200)}`);
}

console.log("\n=== PROJECTS / REPOS state ===");
const projectMappings = db.prepare("SELECT * FROM project_repo_mappings ORDER BY project_key, repo_relative_path").all();
console.log(`project_repo_mappings count: ${projectMappings.length}`);
for (const m of projectMappings) console.log(`  ${m.project_key} -> ${m.repo_relative_path}`);

console.log("\n=== REPO PROFILES ===");
const profiles = db.prepare("SELECT project_key, display_name, source, default_branch, default_build_working_directory, default_registry, registry_hints_json, required_sdks_json, ui_test_globs_json, notes, created_at, updated_at FROM repo_profiles ORDER BY project_key").all();
console.log(`count: ${profiles.length}`);
for (const p of profiles) {
  console.log(`  ${p.project_key} (${p.source}) — ${p.display_name}`);
  console.log(`    branch=${p.default_branch} buildDir=${p.default_build_working_directory} registry=${p.default_registry}`);
  console.log(`    sdks=${p.required_sdks_json} uiTestGlobs=${p.ui_test_globs_json}`);
  console.log(`    notes=${(p.notes||'').slice(0,140)}`);
}

console.log("\n=== VALIDATION PROFILES ===");
const vps = db.prepare("SELECT id, project_key, repo_relative_path, label, kind, command, working_directory, source, confidence, expected_runtime_ms, last_observed_runtime_ms, notes FROM validation_profiles ORDER BY project_key, kind").all();
console.log(`count: ${vps.length}`);
for (const v of vps) {
  console.log(`  ${v.id}`);
  console.log(`    project=${v.project_key} repo=${v.repo_relative_path} kind=${v.kind} source=${v.source}`);
  console.log(`    cmd=${v.command} cwd=${v.working_directory} expected=${v.expected_runtime_ms} observed=${v.last_observed_runtime_ms}`);
}

console.log("\n=== REPO INTELLIGENCE (LA + global) ===");
const rie = db.prepare("SELECT id, project_key, repo_relative_path, type, title, source, approved, tags_json, created_at FROM repo_intelligence_entries WHERE project_key IS NULL OR project_key = 'LA' ORDER BY created_at DESC").all();
console.log(`count: ${rie.length}`);
for (const r of rie) {
  console.log(`  ${r.id} (${r.source}/${r.approved ? 'approved' : 'pending'}) type=${r.type}`);
  console.log(`    project=${r.project_key} repo=${r.repo_relative_path} title=${r.title}`);
  console.log(`    tags=${r.tags_json}`);
}
