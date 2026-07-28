# Claude Pet Core V1 UX Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disconnected Settings and Response workflows with one dependable, minimal desktop-agent window supporting shared sessions with multiple named agents and exactly one agent/provider/model per turn.

**Architecture:** Keep Electron main and the existing provider, permission, activity, attachment, and process boundaries authoritative. Migrate encrypted session persistence to shared sessions with participant-agent attribution, expose one main-owned immutable application snapshot through narrow IPC intents, and render a two-column vanilla-JS interface with secondary Settings and Activity views.

**Tech Stack:** Electron 43.1.1, Node.js 22.12+ test runner, context-isolated vanilla JavaScript, HTML/CSS, Electron `safeStorage`, Python/Pillow atlas validation.

## Global Constraints

- Windows 10 22H2 build 19045+ or Windows 11 x64; no WSL installation belongs to this plan.
- Preserve genuine Workspace fail-closed behavior and the permanent Full Computer warning.
- One selected agent snapshots exactly one saved connection, provider, and model for a turn.
- Only one run may execute in the entire application at a time.
- No agent delegation, parallel model calls, or multi-model skill execution belongs to this plan.
- Renderer state is never authorization, connection, session-ownership, or permission proof.
- Agent instructions and session turns remain encrypted with Electron `safeStorage`.
- Keep the current vanilla-JS renderer architecture; add no UI framework or production dependency.
- Use `npm.cmd` from PowerShell and remove `ELECTRON_RUN_AS_NODE` only from live Electron child processes.
- Refresh `PROJECT_CHECKLIST.html`, `docs/project-context.md`, and `docs/BUILD_LOG.md` after every verified task.

---

## File Structure

### Main-owned domain

- `src/agent/sessionStore.js` — version-2 encrypted agent/shared-session schema and version-1 migration.
- `src/agent/sessionCoordinator.js` — participant selection, connection disclosure, sequential run routing, and immutable public snapshots.
- `src/agent/sessionContext.js` — bounded provider-neutral history with agent attribution and active-agent instructions.
- `src/app/appSnapshot.js` — combines coordinator, connection, run, activity, and presentation state into one frozen renderer payload.
- `src/appWindow.js` — creates the main window and validates all `app:*` IPC intents.
- `src/app-preload.js` — exposes the exact context-isolated main-window bridge.

### Renderer

- `src/app/index.html` — semantic shell for sidebar, conversation, composer, drawer, dialogs, and Settings.
- `src/app/app.css` — neutral dark design system and responsive two-column layout.
- `src/app/app.js` — subscribes once, dispatches intents, owns focus/dialog behavior, and delegates rendering.
- `src/app/sidebar.js` — agent status roster and shared-session navigation.
- `src/app/conversation.js` — attributed turns, compact activity cards, result/error states, and composer.
- `src/app/settings.js` — connection, access, model, agent-profile, and participant editors.

### Existing shell integration

- `src/main.js` — creates the unified app controller and routes pet/tray actions to it.
- `src/preload.js`, `src/renderer/renderer-main.js` — send a validated pet-open-app intent.
- `src/trayController.js`, `src/trayMenu.js` — replace Settings/response entries with Open Claude Pet.
- `src/settingsWindow.js`, `src/responseWindow.js` and their renderer folders — retained until Task 6 parity, then removed.

---

### Task 1: Shared Sessions and Encrypted Agent Profiles

**Files:**
- Modify: `src/agent/sessionStore.js`
- Modify: `tests/sessionStore.test.js`
- Modify: `tests/sessionContext.test.js`
- Create: `tests/fixtures/session-store-v1.json`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Consumes: existing `{ isAvailable(), encrypt(text), decrypt(buffer) }` crypto boundary.
- Produces:
  - `createAgent({ name, marker, instruction })`
  - `updateAgent(id, { name, marker, instruction })`
  - `getAgentProfile(id) -> { id, name, marker, instruction }`
  - `createSession({ title, workspacePath, participant: { agentId, connectionId } })`
  - `addParticipant({ sessionId, agentId, connectionId })`
  - `removeParticipant({ sessionId, agentId })`
  - `selectParticipant({ sessionId, agentId })`
  - `appendTurn(sessionId, { role, text, agentId, provider, model, changedFiles })`
  - public session shape `{ id, title, workspacePath, participants, activeAgentId, createdAt, updatedAt, turnCount, lastProvider }`

- [ ] **Step 1: Write failing version-2 schema and migration tests**

Add tests proving that a version-1 store migrates without plaintext leakage, every old nested
session becomes a top-level shared session, its former owner becomes the first participant, and
selection is preserved:

```js
test('migrates version 1 nested sessions into encrypted version 2 shared sessions', async () => {
  await fs.copyFile(fixturePath('session-store-v1.json'), filePath);
  const store = buildStore();
  await store.initialize();
  const snapshot = await store.getSelection();
  const sessions = await store.listSessions();
  assert.equal(snapshot.sessionId, 'session-old');
  assert.deepEqual(sessions[0].participants, [
    { agentId: 'agent-old', connectionId: 'offline' },
  ]);
  assert.equal(sessions[0].activeAgentId, 'agent-old');
  assert.equal((await store.getContextTurns('session-old'))[0].agentId, 'agent-old');
  assert.equal((await fs.readFile(filePath, 'utf8')).includes('private instruction'), false);
});
```

Add rejection tests for duplicate participants, removing the final participant, selecting an
outsider, more than 8 participants, an instruction over 2,000 UTF-8 bytes, and malformed
`agentId` attribution in a persisted turn.

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

```powershell
node --test --test-isolation=none tests/sessionStore.test.js tests/sessionContext.test.js
```

Expected: FAIL because `listSessions`, participant mutations, encrypted instructions, and turn
`agentId` do not exist.

- [ ] **Step 3: Implement schema version 2 and one-time migration**

Use this persisted structure:

```js
{
  version: 2,
  selection: { sessionId: 'session-id' },
  agents: [{
    id: 'agent-id',
    name: 'Researcher',
    marker: 'amber',
    encryptedInstruction: '<base64 safeStorage ciphertext>',
    createdAt: '<ISO>',
    updatedAt: '<ISO>',
  }],
  sessions: [{
    id: 'session-id',
    title: 'Investigate issue',
    workspacePath: 'Z:\\workspace',
    participants: [{ agentId: 'agent-id', connectionId: 'connection-id' }],
    activeAgentId: 'agent-id',
    createdAt: '<ISO>',
    updatedAt: '<ISO>',
    turnCount: 0,
    lastProvider: null,
    encryptedTurns: '<optional base64 safeStorage ciphertext>',
  }],
}
```

Set `MAX_PARTICIPANTS_PER_SESSION = 8` and `MAX_AGENT_INSTRUCTION_BYTES = 2000`. Migration must
decrypt old turns, add the former owner `agentId`, encrypt the new turn array, encrypt an empty
instruction when none existed, write version 2 atomically, and only then replace in-memory state.
If any decrypt, validation, encryption, or write fails, leave the original file untouched and
throw `SESSION_PERSISTENCE_UNAVAILABLE`.

- [ ] **Step 4: Run focused persistence tests**

Run the Step 2 command.

Expected: all session-store and context tests PASS; on-disk scans find neither turn text nor agent
instructions.

- [ ] **Step 5: Refresh canonical docs and commit**

Document shared-session schema version 2, the eight-participant ceiling, encrypted instructions,
and one-run limitation. Refresh the checklist from the verified state.

```powershell
git add src/agent/sessionStore.js tests/sessionStore.test.js tests/sessionContext.test.js tests/fixtures/session-store-v1.json docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "feat: add shared multi-agent sessions"
```

---

### Task 2: Sequential Agent Routing and Attributed Context

**Files:**
- Modify: `src/agent/sessionCoordinator.js`
- Modify: `src/agent/sessionContext.js`
- Modify: `src/agent/agentErrors.js`
- Modify: `tests/sessionCoordinator.test.js`
- Modify: `tests/sessionContext.test.js`
- Modify: `tests/agentRuntime.test.js`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Consumes: Task 1 shared-session store and existing immutable connection snapshots.
- Produces:
  - `selectParticipant({ sessionId, agentId })`
  - `setParticipantConnection({ sessionId, agentId, connectionId })`
  - `runGoal(text)` routed through the active participant only
  - coordinator snapshot `{ agents, sessions, selection, session, activeAgent, turns, connections, busy }`
  - `buildNeutralSessionPrompt({ turns, agents, activeAgent, currentText })`

- [ ] **Step 1: Write failing sequential-routing tests**

Add a two-agent session test:

```js
test('routes one turn through only the selected participant', async () => {
  await coordinator.selectParticipant({ sessionId: 'shared', agentId: 'reviewer' });
  await coordinator.runGoal('Review the result');
  assert.deepEqual(managerRuns.map((run) => run.connectionId), ['codex-reviewer']);
  assert.deepEqual((await coordinator.snapshot()).turns.slice(-2).map((turn) => turn.agentId), [
    'reviewer', 'reviewer',
  ]);
});
```

Also prove that participant changes are rejected while busy, a different-workspace connection is
rejected before disclosure, cross-provider agent switching asks once with both agent names, cancel
is atomic, stale selection expires before the provider runs, and the prompt contains bounded
agent-attributed history without native resume/auth/config data.

- [ ] **Step 2: Run focused coordinator tests and verify failure**

```powershell
node --test --test-isolation=none tests/sessionCoordinator.test.js tests/sessionContext.test.js tests/agentRuntime.test.js
```

Expected: FAIL because sessions currently belong to one agent and routing reads
`session.nextConnectionId`.

- [ ] **Step 3: Implement participant-owned connection routing**

Resolve the selected session and its `activeAgentId`, then resolve that participant's immutable
connection. Before `manager.runGoal`, re-read selection, participant, connection revision, and
workspace. Append the user and assistant turns with the same `agentId`.

The neutral envelope must use:

```text
<claude_pet_active_agent>
Name: Reviewer
Instruction: Check completed work for concrete defects.
</claude_pet_active_agent>
<claude_pet_session_history>
[Agent: Researcher | Provider: offline-demo | Model: offline-demo]
...
</claude_pet_session_history>
<claude_pet_current_request>
Review the result
</claude_pet_current_request>
```

Escape XML metacharacters, keep the existing bounded-history omission marker, and never include
encrypted fields or connection secrets.

- [ ] **Step 4: Run focused and canonical Node tests**

```powershell
node --test --test-isolation=none tests/sessionCoordinator.test.js tests/sessionContext.test.js tests/agentRuntime.test.js
npm.cmd test
```

Expected: focused tests PASS and the canonical Node suite reports zero failures.

- [ ] **Step 5: Refresh canonical docs and commit**

```powershell
git add src/agent/sessionCoordinator.js src/agent/sessionContext.js src/agent/agentErrors.js tests/sessionCoordinator.test.js tests/sessionContext.test.js tests/agentRuntime.test.js docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "feat: route shared sessions through one agent"
```

---

### Task 3: Unified Main-Owned Application Snapshot

**Files:**
- Create: `src/app/appSnapshot.js`
- Create: `src/appWindow.js`
- Create: `src/app-preload.js`
- Create: `tests/appSnapshot.test.js`
- Create: `tests/appWindow.test.js`
- Modify: `src/main.js`
- Modify: `tests/preloadBoundary.test.js`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Consumes: coordinator snapshot, connection-store public metadata, manager snapshot, sanitized
  activity store, response preference, and existing Full Computer authorization.
- Produces:
  - `createAppSnapshot({ coordinator, connections, manager, activity, view, notice })`
  - `createAppWindowController(options).show({ view = 'conversation' })`
  - renderer bridge `window.claudePetApp` with `snapshot`, `subscribe`, and `intent`
  - one pushed channel: `app:snapshot`

- [ ] **Step 1: Write failing snapshot and sender-validation tests**

Assert the exact frozen top-level keys:

```js
assert.deepEqual(Object.keys(snapshot), [
  'view', 'agents', 'sessions', 'selection', 'activeAgent', 'session',
  'turns', 'connections', 'run', 'activity', 'notice',
]);
assert.equal(JSON.stringify(snapshot).includes('encrypted'), false);
assert.equal(JSON.stringify(snapshot).includes('dismissCapability'), false);
```

Exercise every intent with the expected sender and a forged sender. The initial allowlist is:

```js
[
  'select-session', 'create-session', 'rename-session', 'delete-session',
  'create-agent', 'update-agent', 'delete-agent',
  'add-participant', 'remove-participant', 'select-participant',
  'set-participant-connection', 'submit-goal', 'stop-run', 'retry-run',
  'choose-text-file', 'save-connection', 'delete-connection',
  'test-connection', 'begin-provider-setup', 'set-view',
]
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
node --test --test-isolation=none tests/appSnapshot.test.js tests/appWindow.test.js tests/preloadBoundary.test.js
```

Expected: FAIL because the application snapshot and window bridge do not exist.

- [ ] **Step 3: Implement snapshot composition and narrow IPC**

Make `appWindow.js` translate each intent into a typed main-owned operation. `choose-text-file`
opens the main-owned file dialog and passes its selected path directly to the existing attachment
authorization boundary; the renderer never supplies an arbitrary path. Reject unknown keys,
NULs, oversized strings, cross-session participant edits, busy mutations, and renderer-provided
permission proof. Publish once after every accepted state change and once for each sanitized
activity update. Do not publish separate activity/state events and do not poll from the renderer.

- [ ] **Step 4: Run focused and preload-boundary tests**

Run the Step 2 command.

Expected: PASS, including forged-sender, unknown-intent, secret-field, and duplicate-subscription
tests.

- [ ] **Step 5: Refresh canonical docs and commit**

```powershell
git add src/app/appSnapshot.js src/appWindow.js src/app-preload.js src/main.js tests/appSnapshot.test.js tests/appWindow.test.js tests/preloadBoundary.test.js docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "feat: add unified app state boundary"
```

---

### Task 4: Minimal Main Shell, Sidebar, and First-Run Flow

**Files:**
- Create: `src/app/index.html`
- Create: `src/app/app.css`
- Create: `src/app/app.js`
- Create: `src/app/sidebar.js`
- Create: `tests/appPresentation.test.js`
- Create: `tests/appRenderer.test.js`
- Modify: `src/appWindow.js`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Consumes: Task 3 `window.claudePetApp` bridge and immutable snapshot.
- Produces:
  - `renderSidebar(root, snapshot, dispatch)`
  - accessible first-run dialog emitting `create-agent`, `save-connection`, and `create-session`
  - resizable framed 1080 × 720 main window with 900 × 650 minimum

- [ ] **Step 1: Write failing presentation and interaction tests**

Test pure rendered states for:

- clean profile with one `Start with Offline Demo` action;
- agent roster statuses `running`, `waiting`, `idle`, and `error`;
- shared sessions not duplicated under every participant;
- inline create/rename forms without `window.prompt`;
- keyboard selection and visible focus;
- Settings fixed at the sidebar bottom;
- no text matching `executor`, `permission profile`, or `bounded visible history`.

Derive each agent's status in `appSnapshot.js`: the active run's agent is `running`; an agent with
a pending user-action notice is `waiting`; the selected agent whose last run failed is `error`;
all others are `idle`. The renderer must not infer status from colors, timers, or local state.

- [ ] **Step 2: Run renderer tests and verify failure**

```powershell
node --test --test-isolation=none tests/appPresentation.test.js tests/appRenderer.test.js
```

Expected: FAIL because the unified renderer files do not exist.

- [ ] **Step 3: Implement the semantic shell and design tokens**

Define CSS tokens without gradients or glass effects:

```css
:root {
  --bg: #141311;
  --panel: #1c1a17;
  --panel-raised: #24211d;
  --text: #f4efe6;
  --muted: #aaa198;
  --border: #39342e;
  --accent: #d99045;
  --danger: #e56b6f;
  --focus: #8db4ff;
  --space: 8px;
}
```

Use native window chrome, a 264 px sidebar, a flexible main region, 14–16 px system type, 40 px
minimum primary controls, and a single-column fallback below 900 px. First run must complete
folder, access, optional agent name, and first task without showing the full Settings form.

- [ ] **Step 4: Run renderer tests and a local static layout check**

Run the Step 2 command and verify `index.html` at 900 × 650 and 1440 × 900 through Electron
DevTools screenshots.

Expected: tests PASS; no clipping, horizontal scrolling, empty selects, or unexplained disabled
buttons.

- [ ] **Step 5: Refresh canonical docs and commit**

```powershell
git add src/app/index.html src/app/app.css src/app/app.js src/app/sidebar.js src/appWindow.js tests/appPresentation.test.js tests/appRenderer.test.js docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "feat: add minimal Claude Pet main shell"
```

---

### Task 5: Conversation, Activity, Agents, and Secondary Settings

**Files:**
- Create: `src/app/conversation.js`
- Create: `src/app/settings.js`
- Modify: `src/app/index.html`
- Modify: `src/app/app.css`
- Modify: `src/app/app.js`
- Modify: `tests/appPresentation.test.js`
- Modify: `tests/appRenderer.test.js`
- Create: `tests/appConversation.test.js`
- Create: `tests/appSettings.test.js`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Consumes: unified snapshot and intent dispatcher from Tasks 3–4.
- Produces:
  - `renderConversation(root, snapshot, dispatch)`
  - `renderActivityDrawer(root, snapshot, dispatch)`
  - `renderSettings(root, snapshot, dispatch)`
  - persistent `Ask <agent>` composer with attachment, Send, and Stop

- [ ] **Step 1: Write failing conversation and Settings tests**

Cover:

- per-turn agent/provider/model attribution;
- one compact card per sanitized file, command, tool, permission, network, or usage event;
- card details collapsed by default;
- agent selector limited to session participants;
- Send replaced by Stop while busy;
- successful, failed, and stopped terminal states with Retry and Continue;
- 20,000-character response and 100 activity events contained by scrolling;
- connection editor grouped as Connections, Access, Model, Advanced;
- Full Computer warning remains visible in conversation and Settings;
- removing a participant with attributed history preserves the turns;
- active agent/connection changes disabled while busy.

- [ ] **Step 2: Run focused UI tests and verify failure**

```powershell
node --test --test-isolation=none tests/appPresentation.test.js tests/appRenderer.test.js tests/appConversation.test.js tests/appSettings.test.js
```

Expected: FAIL because conversation and secondary Settings renderers do not exist.

- [ ] **Step 3: Implement conversation, drawer, and Settings**

Render messages as semantic articles. Display assistant identity as
`Reviewer · Codex · gpt-5.6-terra`; display the user's targeted turn as `You → Reviewer`.
Summarize activity with deterministic copy:

```js
const ACTIVITY_LABELS = Object.freeze({
  file: (event) => `${event.operation === 'write' ? 'Updated' : 'Read'} ${event.path}`,
  command: (event) => event.exitCode === 0 ? 'Command completed' : 'Command failed',
  tool: (event) => `Used ${event.toolName}`,
  permission: (event) => `${event.decision === 'allow' ? 'Allowed' : 'Denied'} ${event.permission}`,
  network: () => 'Used network access',
  usage: () => 'Updated token usage',
});
```

Keep advanced event detail sanitized, preserve newlines in responses, use `textContent` for all
provider output, and return focus to the composer after accepted intents.

- [ ] **Step 4: Run focused UI tests**

Run the Step 2 command.

Expected: PASS with no raw HTML injection, clipped long content, or success-only dismissal logic.

- [ ] **Step 5: Refresh canonical docs and commit**

```powershell
git add src/app/conversation.js src/app/settings.js src/app/index.html src/app/app.css src/app/app.js tests/appPresentation.test.js tests/appRenderer.test.js tests/appConversation.test.js tests/appSettings.test.js docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "feat: add usable agent conversation workflow"
```

---

### Task 6: Lifecycle Parity, Legacy Removal, and Packaged Visual Gate

**Files:**
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/renderer/renderer-main.js`
- Modify: `src/trayController.js`
- Modify: `src/trayMenu.js`
- Modify: `src/appWindow.js`
- Delete: `src/settingsWindow.js`
- Delete: `src/settings-preload.js`
- Delete: `src/settings/index.html`
- Delete: `src/settings/settings.css`
- Delete: `src/settings/settings.js`
- Delete: `src/responseWindow.js`
- Delete: `src/response-preload.js`
- Delete: `src/response/index.html`
- Delete: `src/response/response.css`
- Delete: `src/response/response.js`
- Modify/Delete: legacy Settings/Response tests after equivalent app-window coverage exists
- Create: `tests/appLifecycle.test.js`
- Modify: `tests/trayMenu.test.js`
- Modify: `tests/trayController.test.js`
- Modify: `tests/verifyPackage.test.js`
- Modify: `scripts/verify_package.js`
- Modify: `README.md`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Consumes: complete unified window and existing pet/tray/package boundaries.
- Produces: one production main window opened by pet, tray, first launch, or task response.

- [ ] **Step 1: Write failing lifecycle and parity tests**

Prove:

- click pet and tray `Open Claude Pet` reuse one main window;
- close hides to tray without cancelling a run;
- task success, failure, and Stop all leave usable Continue/Retry controls;
- retry repeats only the visible user request through the currently selected participant;
- app reload restores selected shared session and attributed turns;
- provider switch disclosure, text attachment disclosure, Full Computer warning, and busy guards
  remain main-owned;
- legacy response/settings channels and files are absent from the package;
- only one renderer subscription exists and no one-second polling remains.

- [ ] **Step 2: Run lifecycle tests and verify failure**

```powershell
node --test --test-isolation=none tests/appLifecycle.test.js tests/trayMenu.test.js tests/trayController.test.js tests/verifyPackage.test.js
```

Expected: FAIL while pet/tray still open Settings and legacy windows remain packaged.

- [ ] **Step 3: Route production entry points and remove legacy windows**

Make first launch show the main window. Pet click and tray action call
`appWindowController.show({ view: 'conversation' })`. During a run, closing only hides the window;
Quit remains a tray-only explicit action. Remove legacy IPC registration after every equivalent
intent test is green.

- [ ] **Step 4: Run complete automated verification**

```powershell
npm.cmd test
py -m pytest -q
npm.cmd run package:win
npm.cmd run verify:package
git diff --check
```

Expected: zero Node/Python failures; package scan contains the unified app files, contains no
legacy Settings/Response renderer, and contains no plaintext session or agent instruction.

- [ ] **Step 5: Run the fresh-profile Electron gate**

With a temporary `userData` directory:

1. Complete first-run Offline Demo setup.
2. Create a second named agent and add it to the same session.
3. Run one goal with Agent A and a follow-up with Agent B.
4. Verify only one run is active and both turns retain correct attribution.
5. Attach one UTF-8 text file.
6. Stop a run, retry it, and complete it.
7. Trigger a controlled failure and recover.
8. Close/reopen through the tray and restart the app.
9. Verify the selected session, participants, history, and access badge restore.
10. Capture 900 × 650 and 1440 × 900 screenshots plus console/page-error logs.

- [ ] **Step 6: Refresh canonical docs and commit**

Record exact test totals, package file/byte totals, archive SHA-256, screenshots, and any deferred
UX findings.

```powershell
git add -A src tests scripts README.md docs PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "feat: ship unified Claude Pet agent workspace"
```

Stop for the user's manual packaged-app acceptance gate. Do not begin optional WSL Tasks 20–23 or
future multi-model skill work.
