# Codex-First Connection Slice Implementation Plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans`; do not use subagents.

**Goal:** Add an honest Codex connection flow to the existing unified Settings view.

**Architecture:** Reuse the Agent Manager's validated executor registry and the main-owned Full
Computer authorization object. The renderer submits only public drafts and connection ids, while
main returns public status/setup results for the exact saved connection.

**Constraints:** Preserve the visual shell; no credentials in the renderer; Full Computer remains
explicitly confirmed; Workspace stays unavailable with no fallback; do not change selected session
participant while saving, testing, or signing in.

### Task 1: Targeted main-process connection actions

**Files:** `src/agent/agentManager.js`, `src/appWindow.js`, `tests/agentManager.test.js`,
`tests/appWindow.test.js`

- [ ] Write failing tests proving status, permission verification, and setup use the supplied saved
  Codex connection without mutating active selection; malformed, missing, busy, or foreign ids fail
  before an executor call.
- [ ] Run the focused tests and witness the missing targeted-delegation failure.
- [ ] Add minimal `getStatusFor`, `verifyPermissionProfileFor`, and `beginSetupFor` manager methods;
  make the existing intents require `{ connectionId }` and return public, structured results.
- [ ] Re-run the focused tests green.

### Task 2: Inline Codex editor and visible feedback

**Files:** `src/app/settings.js`, `src/app/app.js`, `src/app/app.css`, `tests/appSettings.test.js`,
`tests/appRenderer.test.js`

- [ ] Write failing renderer tests for Codex setup/edit fields, supported model/effort choices,
  disabled Workspace, permanent Full Computer warning, exact-card Test/Sign in actions, pending
  controls, and persisted visible success/error feedback.
- [ ] Run those tests and witness RED.
- [ ] Implement the smallest editor, using `save-connection` and its existing native confirmation;
  render public results and recovery copy beside the connection controls.
- [ ] Re-run the focused UI tests green.

### Task 3: Verify real lifecycle and package

**Files:** `scripts/capture_app_e2e.js` or a focused successor, `tests/appLifecycle.test.js`,
`docs/project-context.md`, `docs/BUILD_LOG.md`, `PROJECT_CHECKLIST.html`

- [ ] Add a failing fresh-profile/CDP test or deterministic walkthrough assertion for save/restart,
  status test, official setup launch, Full Computer cancellation, and unaffected Offline Demo flow.
- [ ] Run it red, then add only the package/CDP support required to drive the visible controls.
- [ ] Run focused Node tests, the full Node suite, Python tests, package, package verifier, and the
  fresh-profile CDP walkthrough. Capture screenshots and console/page-error output.
- [ ] Refresh the canonical docs/checklist, record exact evidence, commit, and stop at the official
  Codex OAuth screen if account approval is required.
