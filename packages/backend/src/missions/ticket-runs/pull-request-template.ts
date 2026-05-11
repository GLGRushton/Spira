export interface ChangeCategories {
  hasBackend: boolean;
  hasFrontend: boolean;
  hasMigrations: boolean;
}

export interface PullRequestBodyInput {
  commitMessages: readonly string[];
  categories: ChangeCategories;
}

const BACKEND_EXTENSIONS = new Set([
  ".cs",
  ".csproj",
  ".sln",
  ".fs",
  ".fsproj",
  ".vb",
  ".vbproj",
  ".razor",
  ".cshtml",
]);

const FRONTEND_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".svelte",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
]);

const MIGRATIONS_PATH_SEGMENT = "/migrations/";

const DEVOPS_TICKET_URL =
  "https://youtrack.parliament.uk/newIssue?project=DEVOPS&summary=Add%20variables%20to%20Octopus&description=As%20a%20Developer,%0AI%20want%20to%20add%20variables%20to%20Octopus%0ASo%20that%20our%20application%20variables%20can%20easily%20be%20configured%20and%20amended%20on%20Octopus%20rather%20than%20in%20code.%0A%0ADetails%20of%20variable:%0AVariable%20Name%20%3D%20%20%20%0AVariable%20Value:%20%0AApplicationEnvironment%2FName%20of%20application%20%3D&c=Points%201&c=Team%20Phoenix&c=State%20To%20Do&draftId=2-54151";

const API_GUIDELINES_URL =
  "https://github.com/UK-Parliament/software-engineering_handbook/blob/master/API/1-index.md";
const BACKEND_CODING_STANDARDS_URL =
  "https://github.com/UK-Parliament/software-engineering_handbook/blob/master/CodingStandards/C%23/index.md";
const FRONTEND_CODING_STANDARDS_URL =
  "https://github.com/UK-Parliament/software-engineering_handbook/blob/master/CodingStandards/FrontEnd/index.md";
const UI_STANDARDS_URL =
  "https://github.com/UK-Parliament/software-engineering_handbook/blob/master/UIArchitecture/index.md";
const AXE_DEVTOOLS_URL =
  "https://chromewebstore.google.com/detail/axe-devtools-web-accessib/lhdoppojpmngadmnindnejefpokejbdd";
const WAVE_URL = "https://wave.webaim.org/extension/";

export const categorizeChangedFiles = (paths: readonly string[]): ChangeCategories => {
  let hasBackend = false;
  let hasFrontend = false;
  let hasMigrations = false;

  for (const rawPath of paths) {
    const normalized = rawPath.replace(/\\/g, "/").toLowerCase();
    if (normalized.includes(MIGRATIONS_PATH_SEGMENT)) {
      hasMigrations = true;
    }
    const dotIndex = normalized.lastIndexOf(".");
    if (dotIndex === -1) {
      continue;
    }
    const extension = normalized.slice(dotIndex);
    if (BACKEND_EXTENSIONS.has(extension)) {
      hasBackend = true;
    }
    if (FRONTEND_EXTENSIONS.has(extension)) {
      hasFrontend = true;
    }
  }

  return { hasBackend, hasFrontend, hasMigrations };
};

const checkbox = (checked: boolean): string => (checked ? "- [x]" : "- [ ]");

const renderSummary = (commitMessages: readonly string[]): string => {
  const trimmed = commitMessages.map((message) => message.trim()).filter((message) => message.length > 0);
  if (trimmed.length === 0) {
    return "## Summary\n\n_No commit messages found on this branch._";
  }
  return `## Summary\n\n${trimmed.join("\n\n---\n\n")}`;
};

const renderConformity = (): string =>
  [
    "## Conformity",
    "(Make sure you put a 'x' in the boxes or check these, add N/A if not applicable)",
    "- [x] I self-reviewed my code",
    "- [x] I have added unit tests",
    "- [x] I have ran all unit tests and these pass",
    "- [x] I have ran local integration tests and these pass",
    "- [ ] I have attached relevant screenshots",
    "- [ ] I have updated relevant documentation",
  ].join("\n");

const renderDatabase = (hasMigrations: boolean): string =>
  [
    "#### Database",
    `${checkbox(hasMigrations)} Does this change have migrations? (if yes, have they been rebased)`,
  ].join("\n");

const renderBackend = (): string =>
  [
    "#### Backend",
    `- [x] I have followed [API guidelines](${API_GUIDELINES_URL}) where applicable`,
    `- [x] I have followed [Coding Standards for backend](${BACKEND_CODING_STANDARDS_URL})`,
    `- [ ] If this introduces a new variable, create a [DevOps ticket](${DEVOPS_TICKET_URL})`,
  ].join("\n");

const renderFrontend = (): string =>
  [
    "#### Frontend",
    `- [x] I have followed [Coding Standards for frontend](${FRONTEND_CODING_STANDARDS_URL})`,
    `- [x] I have followed [UI standards](${UI_STANDARDS_URL}) where needed`,
    "- [x] I have checked any UI changes I have made at desktop/tablet/phone sizes",
    `- [ ] I have ran appropriate accessibility scans against any UI changes in the browser ([axe-core DevTools](${AXE_DEVTOOLS_URL}) and [WAVE](${WAVE_URL}))`,
  ].join("\n");

export const buildPullRequestBody = (input: PullRequestBodyInput): string => {
  const sections: string[] = [renderSummary(input.commitMessages), renderConformity(), renderDatabase(input.categories.hasMigrations)];
  if (input.categories.hasBackend) {
    sections.push(renderBackend());
  }
  if (input.categories.hasFrontend) {
    sections.push(renderFrontend());
  }
  return sections.join("\n\n");
};
