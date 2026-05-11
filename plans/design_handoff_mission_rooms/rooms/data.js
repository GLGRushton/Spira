// Mock data shaped like the real TicketRunSummary / review snapshot / services.
// Realistic enough to stress the layouts; small enough to fit one screen.
window.ROOMS_DATA = {
  mission: {
    id: "LH-417",
    title: "Replace ticket recovery banner with inline state",
    branch: "fix/lh-417-recovery-banner",
    status: "awaiting-review",
    pass: { current: 2, total: 3 },
    activeRoom: "changes",
  },
  // -------- CHANGES --------
  repos: [
    {
      path: "packages/renderer",
      branch: "fix/lh-417-recovery-banner",
      add: 142, del: 88,
      files: [
        { path: "src/components/missions/rooms/MissionChangesRoom.tsx", status: "M", add: 42, del: 38, hunks: 3 },
        { path: "src/components/missions/MissionShell.tsx",            status: "M", add: 18, del: 24, hunks: 2 },
        { path: "src/components/missions/rooms/MissionDetailsRoom.tsx", status: "M", add: 31, del: 18, hunks: 4 },
        { path: "src/components/missions/MissionRecoveryBanner.tsx",   status: "D", add: 0,  del: 8,  hunks: 1 },
        { path: "src/components/missions/RecoveryInline.tsx",          status: "A", add: 51, del: 0,  hunks: 1 },
      ],
      patch: [
        { kind: "meta", text: "diff --git a/MissionChangesRoom.tsx b/MissionChangesRoom.tsx" },
        { kind: "meta", text: "@@ -118,9 +118,12 @@" },
        { kind: "ctx",  text: "  const visibleRepoPaths = useMemo(" },
        { kind: "del",  text: "-    () => new Set(controller.reviewSnapshot?.visibleRepoPaths ?? [])," },
        { kind: "add",  text: "+    () => new Set(controller.reviewSnapshot?.visibleRepoPaths ?? [])," },
        { kind: "add",  text: "+    // tighten dependency on snapshot shape" },
        { kind: "ctx",  text: "    [controller.reviewSnapshot?.visibleRepoPaths]," },
        { kind: "ctx",  text: "  );" },
        { kind: "meta", text: "@@ -204,7 +207,11 @@" },
        { kind: "ctx",  text: "    return (" },
        { kind: "del",  text: "-      <div className={projectStyles.emptyState}>" },
        { kind: "add",  text: "+      <div className={styles.empty}>" },
        { kind: "add",  text: "+        <ChevronRight size={12} aria-hidden />" },
        { kind: "ctx",  text: "        Loading mission diff..." },
        { kind: "ctx",  text: "      </div>" },
      ],
    },
    {
      path: "packages/backend",
      branch: "fix/lh-417-recovery-banner",
      add: 24, del: 12,
      files: [
        { path: "src/missions/review-snapshot.ts", status: "M", add: 14, del: 8, hunks: 2 },
        { path: "src/missions/review-state.ts",    status: "M", add: 10, del: 4, hunks: 1 },
      ],
    },
    {
      path: "packages/shared",
      branch: "main",
      add: 7, del: 3,
      files: [
        { path: "src/types/mission.ts", status: "M", add: 7, del: 3, hunks: 1 },
      ],
    },
    {
      path: "packages/mcp-windows-ui",
      branch: "main",
      add: 0, del: 0,
      files: [],
    },
  ],
  submodules: [
    {
      name: "spira-mcp-cli",
      url: "git@github.com:spira/spira-mcp-cli.git",
      branch: "fix/lh-417-recovery",
      add: 18, del: 6,
      parents: [
        { repo: "packages/renderer", aligned: true,  primary: true,  state: "Primary" },
        { repo: "packages/backend",  aligned: false, primary: false, state: "Needs alignment" },
      ],
      files: [
        { path: "src/commands/recover.ts", status: "M", add: 18, del: 6, hunks: 2 },
      ],
    },
  ],
  // -------- ACTIONS --------
  repoActions: [
    {
      path: "packages/renderer",
      branch: "fix/lh-417-recovery-banner",
      upstream: "origin/fix/lh-417-recovery-banner",
      ahead: 2, behind: 0,
      hasDiff: true,
      pushAction: "push",
      commitDraft: "fix(missions): inline recovery banner state\n\nReplaces the floating MissionRecoveryBanner with an inline state\nrow that respects the new room shell.",
      blockedBy: ["spira-mcp-cli"],
      pr: null,
      stage: "commit",
    },
    {
      path: "packages/backend",
      branch: "fix/lh-417-recovery-banner",
      upstream: null,
      ahead: 1, behind: 0,
      hasDiff: false,
      pushAction: "publish",
      commitDraft: "",
      blockedBy: [],
      pr: null,
      stage: "push",
    },
    {
      path: "packages/shared",
      branch: "main",
      upstream: "origin/main",
      ahead: 0, behind: 0,
      hasDiff: false,
      pushAction: "none",
      commitDraft: "",
      blockedBy: [],
      pr: { open: "https://github.com/spira/spira/pull/417", draft: "https://github.com/spira/spira/pull/417/files" },
      stage: "pr",
    },
    {
      path: "packages/mcp-windows-ui",
      branch: "main",
      upstream: "origin/main",
      ahead: 0, behind: 0,
      hasDiff: false,
      pushAction: "none",
      commitDraft: "",
      blockedBy: [],
      pr: null,
      stage: "clean",
    },
  ],
  submoduleActions: [
    {
      name: "spira-mcp-cli",
      branch: "fix/lh-417-recovery",
      committedSha: "8a2c39dfee01",
      worktree: "submodules/spira-mcp-cli",
      hasDiff: true,
      pushAction: "publish",
      needsAlignment: true,
      reconcileRequired: false,
      commitDraft: "feat(cli): expose recover --inline flag",
      pr: null,
      stage: "commit",
    },
  ],
  // -------- PROCESSES --------
  profilesByRepo: [
    {
      repo: "packages/renderer",
      profiles: [
        { id: "renderer-dev",   name: "Renderer · dev",        launcher: "pnpm dev",          env: "Default",     project: "apps/desktop",  url: "http://localhost:5173", launchable: true,  active: true  },
        { id: "renderer-story", name: "Renderer · storybook",  launcher: "pnpm storybook",    env: "Default",     project: "apps/desktop",  url: "http://localhost:6006", launchable: true,  active: false },
        { id: "renderer-prev",  name: "Renderer · preview",    launcher: "pnpm build && preview", env: "Production", project: "apps/desktop",  url: null,                    launchable: false, active: false, reason: "Build artifact missing." },
      ],
    },
    {
      repo: "packages/backend",
      profiles: [
        { id: "backend-dev",  name: "Backend · dev",   launcher: "pnpm dev",     env: "Default", project: "apps/backend", url: "http://localhost:4000", launchable: true,  active: true  },
        { id: "backend-test", name: "Backend · tests", launcher: "pnpm test --watch", env: "Test",   project: "apps/backend", url: null,                  launchable: true,  active: false },
      ],
    },
    {
      repo: "packages/mcp-windows-ui",
      profiles: [
        { id: "mcp-ui-dev", name: "MCP windows UI · dev", launcher: "pnpm dev", env: "Default", project: "packages/mcp-windows-ui", url: "http://localhost:5180", launchable: true, active: false },
      ],
    },
  ],
  processes: [
    {
      id: "p-1", profile: "Renderer · dev", repo: "packages/renderer",
      launcher: "pnpm dev", state: "Running", url: "http://localhost:5173",
      uptime: "00:24:11", cpu: 7.2, mem: 412,
      log: [
        "▲ vite v5.4.2 dev server running at:",
        "  ➜ Local:   http://localhost:5173/",
        "  ➜ Network: http://10.0.0.4:5173/",
        "  ✓ hmr: MissionChangesRoom.tsx",
        "  ✓ hmr: MissionShell.tsx",
        "  ✓ ready in 412 ms",
      ],
    },
    {
      id: "p-2", profile: "Backend · dev", repo: "packages/backend",
      launcher: "pnpm dev", state: "Running", url: "http://localhost:4000",
      uptime: "00:24:08", cpu: 3.1, mem: 198,
      log: [
        "[nest] LOG bootstrap: nest application started",
        "[nest] LOG  GET /missions/LH-417  200  18ms",
        "[nest] LOG  GET /missions/LH-417/review  200  44ms",
        "[nest] LOG  POST /missions/LH-417/services  200  9ms",
      ],
    },
    {
      id: "p-3", profile: "Renderer · storybook", repo: "packages/renderer",
      launcher: "pnpm storybook", state: "Stopped", url: "http://localhost:6006",
      uptime: "—", cpu: 0, mem: 0,
      log: ["[storybook] exited 0"],
      stoppedAt: "08:02",
    },
  ],
};
