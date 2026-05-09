import type {
  RepoIntelligenceRecord,
  RepoProfileRecord,
  SpiraMemoryDatabase,
  ValidationProfileRecord,
} from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { buildRepoGuidanceSection } from "./repo-guidance.js";

const sampleRun = (): TicketRunSummary => ({
  runId: "run-1",
  stationId: "mission:run-1",
  ticketId: "SPI-101",
  ticketSummary: "Test repo guidance injection",
  ticketUrl: "https://example.test/issue/SPI-101",
  projectKey: "alpha",
  status: "working",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1,
  updatedAt: 1,
  startedAt: 1,
  worktrees: [
    {
      repoRelativePath: "apps/web",
      repoAbsolutePath: "C:\\Repos\\apps\\web",
      worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101",
      branchName: "feat/spi-101",
      cleanupState: "retained",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  submodules: [],
  attempts: [],
  missionPhase: "classification",
  missionPhaseUpdatedAt: 1,
  classification: null,
  plan: null,
  validations: [],
  proofStrategy: null,
  missionSummary: null,
  previousPassContext: null,
  proof: {
    status: "not-run",
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofAt: null,
    lastProofSummary: null,
    staleReason: null,
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: [],
});

const stubProfile = (overrides: Partial<RepoProfileRecord> = {}): RepoProfileRecord => ({
  projectKey: "alpha",
  displayName: "Alpha",
  description: "An alpha project",
  defaultBranch: "main",
  defaultBuildWorkingDirectory: "apps/web",
  defaultRegistry: "https://npm.example",
  registryHints: [],
  requiredEnvVars: [],
  requiredSdks: ["node 22"],
  userFacingCopyGlobs: [],
  uiTestGlobs: [],
  notes: null,
  source: "user",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const stubIntelligence = (
  overrides: Partial<RepoIntelligenceRecord> = {},
): RepoIntelligenceRecord => ({
  id: "i-1",
  projectKey: "alpha",
  repoRelativePath: "apps/web",
  type: "briefing",
  title: "Component layout",
  content: "Components live under `src/components/`.",
  tags: [],
  source: "user",
  approved: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const stubValidation = (
  overrides: Partial<ValidationProfileRecord> = {},
): ValidationProfileRecord => ({
  id: "v-1",
  projectKey: "alpha",
  repoRelativePath: "apps/web",
  label: "ClientApp build",
  kind: "build",
  command: "npm run build",
  workingDirectory: "apps/web",
  notes: null,
  confidence: 0.8,
  expectedRuntimeMs: 60_000,
  lastObservedRuntimeMs: null,
  prerequisites: [],
  source: "user",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const stubMemoryDb = (): SpiraMemoryDatabase => ({}) as unknown as SpiraMemoryDatabase;

describe("buildRepoGuidanceSection (Phase 3.5)", () => {
  it("returns null when no profile, no intelligence, and no validations exist", () => {
    const section = buildRepoGuidanceSection(stubMemoryDb(), sampleRun(), {
      fetchProfile: () => null,
      fetchIntelligence: () => [],
      fetchValidations: () => [],
    });
    expect(section).toBeNull();
  });

  it("returns null when projectKey is empty", () => {
    const run = { ...sampleRun(), projectKey: "" };
    const section = buildRepoGuidanceSection(stubMemoryDb(), run, {
      fetchProfile: () => stubProfile(),
      fetchIntelligence: () => [stubIntelligence()],
      fetchValidations: () => [stubValidation()],
    });
    expect(section).toBeNull();
  });

  it("renders profile + briefings + pitfalls + validations in a stable section", () => {
    const section = buildRepoGuidanceSection(stubMemoryDb(), sampleRun(), {
      fetchProfile: () => stubProfile(),
      fetchIntelligence: () => [
        stubIntelligence({ id: "b-1", type: "briefing", title: "Where copy lives" }),
        stubIntelligence({ id: "p-1", type: "pitfall", title: "Registry trap" }),
      ],
      fetchValidations: () => [stubValidation()],
    });
    expect(section).not.toBeNull();
    const text = section as string;
    expect(text).toContain("## Repo guidance");
    expect(text).toContain("### Project alpha (Alpha)");
    expect(text).toContain("### Briefings");
    expect(text).toContain("Where copy lives");
    expect(text).toContain("### Pitfalls");
    expect(text).toContain("Registry trap");
    expect(text).toContain("### Default validation commands");
    expect(text).toContain("`npm run build`");
  });

  it("caps briefings + pitfalls + validations at the documented limits", () => {
    const briefings = Array.from({ length: 10 }, (_, index) =>
      stubIntelligence({ id: `b-${index}`, type: "briefing", title: `Briefing ${index}` }),
    );
    const pitfalls = Array.from({ length: 10 }, (_, index) =>
      stubIntelligence({ id: `p-${index}`, type: "pitfall", title: `Pitfall ${index}` }),
    );
    const validations = Array.from({ length: 20 }, (_, index) =>
      stubValidation({ id: `v-${index}`, command: `cmd-${index}` }),
    );
    const section = buildRepoGuidanceSection(stubMemoryDb(), sampleRun(), {
      fetchProfile: () => null,
      fetchIntelligence: () => [...briefings, ...pitfalls],
      fetchValidations: () => validations,
    });
    const text = section as string;
    // Briefing 0/1/2 should appear; Briefing 3 should not.
    expect(text).toContain("Briefing 0");
    expect(text).toContain("Briefing 2");
    expect(text).not.toContain("Briefing 3");
    expect(text).toContain("Pitfall 2");
    expect(text).not.toContain("Pitfall 3");
    expect(text).toContain("cmd-0");
    expect(text).toContain("cmd-5");
    expect(text).not.toContain("cmd-6");
  });

  it("excludes unapproved intelligence entries even when they exist", () => {
    const section = buildRepoGuidanceSection(stubMemoryDb(), sampleRun(), {
      fetchProfile: () => null,
      fetchIntelligence: () => [
        stubIntelligence({ id: "approved", title: "Approved", approved: true }),
        stubIntelligence({ id: "candidate", title: "Candidate", approved: false }),
      ],
      fetchValidations: () => [],
    });
    const text = section as string;
    expect(text).toContain("Approved");
    expect(text).not.toContain("Candidate");
  });

  it("uses lastObservedRuntimeMs over expectedRuntimeMs for the runtime hint", () => {
    const section = buildRepoGuidanceSection(stubMemoryDb(), sampleRun(), {
      fetchProfile: () => null,
      fetchIntelligence: () => [],
      fetchValidations: () => [
        stubValidation({ expectedRuntimeMs: 90_000, lastObservedRuntimeMs: 30_000 }),
      ],
    });
    const text = section as string;
    expect(text).toContain("~30s");
    expect(text).not.toContain("~90s");
  });
});
