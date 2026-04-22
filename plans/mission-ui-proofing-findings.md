# Mission UI proofing findings

## Context

The goal is to let Shinra, within Missions, launch a UI application for a ticket, verify the change, and capture proof such as a live screenshot without requiring the user to run the app manually.

LA-2681 was used as the concrete example because it is a small LegApp Admin UI change where visual proof would be useful.

## Key finding

Shinra can likely produce the proof you want for **LegApp Admin**, but **not through the current mission flow as-is**.

The important distinction is:

1. **Launching the normal application URL** is not enough, because that path may still hit real Azure AD.
2. **Using the project's existing Playwright-based UI test harness** is much more promising, because that harness already contains a test authentication path that bypasses interactive Azure AD.

## LA-2681 worktree findings

### Worktree location

- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin`

### Playwright is already present

Relevant files found:

- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\AutomationTesting\AutomationTesting.Web.Playwright\Context\DefaultContextOptions.cs`
- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\AutomationTesting\AutomationTesting.Web.Playwright\Management\PlaywrightManager.cs`
- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\AutomationTesting\AutomationTesting.Web.Playwright\Orchestration\PlaywrightTestOrchestrator.cs`

### No reusable Playwright storage state was found

`DefaultContextOptions.Create()` builds a fresh browser context and does **not** load a Playwright storage state file.

Relevant file:

- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\AutomationTesting\AutomationTesting.Web.Playwright\Context\DefaultContextOptions.cs:9-20`

Implication:

- There does **not** appear to be a ready-made `storageState.json` or similar artifact that Missions could simply reuse for authenticated browser runs.

### Real Azure AD is used by the normal application path

Relevant file:

- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\SoftwareEngineeringCommon\SoftwareEngineering.Common.Web\Security\AuthenticationHelper.cs:66-82`

This configures OpenID Connect with Azure AD, which suggests that driving the normal app URL in a generic browser session could still run into real interactive authentication.

### Test authentication already exists for UI tests

Relevant files:

- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\AutomationTesting\AutomationTesting.Web.TestServices.NetCore\Extensions\ServiceCollectionAuthenticationExtensions.cs:8-17`
- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\Submodules\AutomationTesting\AutomationTesting.Web.TestServices.NetCore\Authentication\TestProceduralAzureADAuthHandler.cs:12-52`
- `C:\GitHub\.spira-worktrees\la-2681\legapp-legapp-admin\LegApp.Admin.UI.Tests\PageTests\Bases\IsolatedPageTestBase.cs:11-18`

These show that the existing UI test harness can inject **procedural Azure AD claims** for tests, avoiding the need for a real interactive Azure AD login.

## Answer to the main question

### Can Shinra get the proof you want?

**Yes, likely for LegApp Admin.**

### Can Shinra do it today with the current mission flow?

**No.**

Current Missions can discover and launch UI service profiles, but they do not yet have a first-class flow to:

1. run a project-native UI proof harness,
2. collect screenshots/assertion artifacts, and
3. attach those artifacts back to the mission run.

### Is Azure AD the blocker here?

**Probably not for LegApp Admin, if Missions use the existing test harness path.**

Azure AD is more likely to be a blocker only if Missions try to automate the normal application URL in a generic browser session.

## Recommended direction

### Preferred approach

Add a **mission UI proof mode** that prefers **project-native Playwright harnesses** over generic browser automation.

For LegApp Admin, the ideal flow would be:

1. Mission completes the code change.
2. Shinra starts the relevant UI app or in-process UI harness.
3. Shinra runs a small Playwright proof flow using the existing test authentication path.
4. Shinra saves:
   - screenshot(s),
   - assertion results,
   - URL / route / timestamp metadata,
   - optional DOM or text snapshot.

### Why this is better than generic browser automation

- It avoids depending on interactive Azure AD.
- It reuses project-specific test infrastructure already in the repo.
- It gives stronger proof than a screenshot alone.

## Important nuance about "proof"

A screenshot is useful, but for tickets like LA-2681 it is only part of the proof.

For example:

- AC1 and AC2 are visually demonstrable.
- AC3 ("current stage ends at midnight on the date selected") is better proven by a test assertion or visible computed value capture, not just an image.

Recommendation:

- Treat screenshots as **human-readable evidence**
- Treat Playwright assertions as **behavior proof**

## Proposed implementation stages

### Stage 1

Add mission support for:

- launching a UI-capable mission service,
- waiting for readiness,
- capturing a screenshot artifact,
- attaching the artifact to the mission run.

This gives "proof of life".

### Stage 2

Add mission support for:

- running project-specific Playwright proof flows,
- capturing assertion results,
- storing richer artifacts,
- preferring harness-based auth over live app auth.

This gives "proof of behavior".

## Bottom line

For **LA-2681 / LegApp Admin**, the evidence suggests:

- there is **no reusable Playwright storage state** ready to go,
- but there **is** an existing **test authentication mechanism** that should let Shinra obtain proof without real Azure AD login,
- provided Missions are extended to run the **project's Playwright harness** and save artifacts.
