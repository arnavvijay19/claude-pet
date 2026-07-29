# Claude Pet Unified UI and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add staged readable-file attachments and a clearly separated Agent/Session Settings experience without changing agent execution semantics.

**Architecture:** Main owns file paths, attachment contents, native confirmations, folder dialogs, and destructive confirmations. The renderer owns only bounded drafts, selected Settings tab, safe attachment metadata, and visible feedback; live snapshots may update without erasing user input.

**Tech Stack:** Electron 43, Node.js CommonJS, `node:test`, vanilla HTML/CSS/JavaScript, CDP screenshot scripts.

## Global Constraints

- Begin only after every task and gate in `2026-07-29-security-hardening.md` passes.
- Do not read, edit, stage, launch, stop, or otherwise alter `.workbuddy-ai/`, `LOCAL_PR.html`, WorkBuddy AI, or `C:\Users\eklip\Desktop\review_findings.json`.
- Use the shared `MAX_GOAL_BYTES = 8192` and `attachmentPolicy` contracts.
- Keep attachment paths and contents exclusively in Electron main.
- Keep one staged attachment at or below 48 KiB (`49152` bytes); no PDF, Office, archive, image, audio, or video extraction.
- Preserve official provider sign-in, Full Computer native warning, immutable selected connection, and sequential one-run behavior.
- Support Codex models `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and Claude models `fable`, `opus`, `sonnet` only.
- Real-provider Workspace remains unavailable and never falls back to Full Computer.
- Use 900×650 and 1440×900 as required screenshot viewports.
- Follow red-green TDD and commit after each task.

---

## File Structure

### New files

- `src/bridge/pendingAttachment.js`: one-use main-owned staged attachment state.
- `src/app/draftState.js`: renderer-only composer/Settings draft preservation.
- `tests/pendingAttachment.test.js`: stage, clear, consume, retry metadata, and change handling.
- `tests/appDraftState.test.js`: snapshot-safe draft behavior.

### Modified files

- `src/main.js`, `src/appWindow.js`, `src/app/appSnapshot.js`: dialogs, intents, safe metadata.
- `src/app/app.js`, `src/app/conversation.js`, `src/app/settings.js`, `src/app/sidebar.js`: workflows.
- `src/app/app.css`, `src/app/index.html`: tabs, feedback, attachment chip, responsive layout.
- `src/agent/executors/claudeModels.js`: consumed allowlist only; no registry changes expected.
- `scripts/capture_app_layout.js`, `scripts/capture_app_e2e.js`: visual proof.
- Tests, build log, checklist, and evidence PNGs.

---

### Task 1: Main-owned pending attachment and dialog intents

**Files:**
- Create: `src/bridge/pendingAttachment.js`
- Create: `tests/pendingAttachment.test.js`
- Modify: `src/app/appSnapshot.js`
- Modify: `src/appWindow.js`
- Modify: `src/main.js`
- Modify: `tests/appSnapshot.test.js`
- Modify: `tests/appWindow.test.js`
- Modify: `tests/preloadBoundary.test.js`

**Interfaces:**
- Produces: `createPendingAttachment({ authorize, confirm })`.
- Produces methods: `stage(filePath)`, `clear()`, `snapshot()`, `take()`.
- `snapshot()` returns `null | { name: string, extension: string, size: number }`.
- `take()` returns `null | { name, extension, size, text }` and clears main-owned state.
- Adds intents: `choose-attachment`, `clear-attachment`, `choose-directory`,
  `confirm-delete-session`.

- [ ] **Step 1: Write failing pending-attachment tests**

```js
test('publishes metadata but keeps path and text in main', async () => {
  const pending = createPendingAttachment({
    authorize: async () => ({ consume: async () => ({
      name: 'notes.md', extension: '.md', size: 12, text: 'private text',
    }), cancel: async () => {} }),
    confirm: async () => true,
  });
  await pending.stage('C:\\private\\notes.md');
  assert.deepEqual(pending.snapshot(), { name: 'notes.md', extension: '.md', size: 12 });
  assert.doesNotMatch(JSON.stringify(pending.snapshot()), /private text|C:\\/);
});
```

Add cancellation, replacement cleanup, clear, one-use take, and confirmation rejection cases.

- [ ] **Step 2: Run focused main-boundary tests and witness RED**

```powershell
node --test tests/pendingAttachment.test.js tests/appSnapshot.test.js tests/appWindow.test.js tests/preloadBoundary.test.js
```

Expected: missing controller, intents, and snapshot metadata.

- [ ] **Step 3: Implement the pending controller**

Store only one consumed bounded text object in closure state. Always cancel the authorization
handle in `finally`. `stage` replaces existing state only after the new file passes validation and
confirmation.

- [ ] **Step 4: Add narrow main-owned intents**

`choose-attachment` opens the shared filtered file dialog and calls `pending.stage`. The dialog
filter is generated from `TEXT_ATTACHMENT_EXTENSIONS`.

`choose-directory` opens `showOpenDialog({ properties: ['openDirectory'] })` and returns only one
absolute selected path or `null`.

`confirm-delete-session` validates the current selected session, shows a native destructive
confirmation, and calls the existing `delete-session` path only after acceptance.

Add `pendingAttachment: pending.snapshot()` to the public snapshot allowlist. Reject `path`, `text`,
`content`, or secret-shaped fields.

- [ ] **Step 5: Harden pet drop**

Change `pet:submit-text-file` to stage through the same controller, show the native confirmation,
and reveal the unified app composer. It must not submit a run. Keep exact sender validation.

- [ ] **Step 6: Run focused tests and witness GREEN**

Run the Step 2 command.

Expected: all state, intent, sender, and metadata tests pass.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- src/bridge/pendingAttachment.js src/app/appSnapshot.js src/appWindow.js src/main.js tests/pendingAttachment.test.js tests/appSnapshot.test.js tests/appWindow.test.js tests/preloadBoundary.test.js
git commit -m "feat: stage attachments in main"
```

---

### Task 2: Draft-preserving composer and attachment chip

**Files:**
- Create: `src/app/draftState.js`
- Create: `tests/appDraftState.test.js`
- Modify: `src/app/index.html`
- Modify: `src/app/app.js`
- Modify: `src/app/conversation.js`
- Modify: `src/app/app.css`
- Modify: `src/appWindow.js`
- Modify: `src/main.js`
- Modify: `src/promptController.js`
- Modify: `src/agent/sessionCoordinator.js`
- Modify: `src/agent/sessionContext.js`
- Modify: `tests/appConversation.test.js`
- Modify: `tests/appRenderer.test.js`
- Modify: `tests/appLifecycle.test.js`
- Modify: `tests/promptIntegration.test.js`
- Modify: `tests/sessionCoordinator.test.js`
- Modify: `tests/sessionContext.test.js`

**Interfaces:**
- Produces: `createDraftState()` with `composer(sessionId)`, `setComposer(sessionId, text)`,
  `settings(key)`, `patchSettings(key, patch)`, and `clear*` methods.
- Main request tracker accepts `{ text, attachment }`, where attachment is either null or the
  validated main-only `{ name, extension, size, text }`.
- `promptController.submitText(text, { attachment })` forwards separate fields to the coordinator.
- The coordinator persists only `text + safe attachment metadata` and builds a provider request of
  at most 65,536 bytes containing the escaped attachment data.
- Retry stores the validated request object in main memory and never reopens a path.

- [ ] **Step 1: Write failing draft-preservation tests**

Assert an unsent composer draft survives a second `render(snapshot)` for the same session and
clears after successful submission. Assert changing sessions loads the other keyed draft. Assert
the public DOM contains basename/size but never path or attachment contents. Add coordinator
coverage proving attachment contents reach the current provider request but not the persisted user
turn, later history, snapshot, or retry metadata.

- [ ] **Step 2: Run focused renderer tests and witness RED**

```powershell
node --test tests/appDraftState.test.js tests/appConversation.test.js tests/appRenderer.test.js tests/appLifecycle.test.js tests/promptIntegration.test.js tests/sessionCoordinator.test.js tests/sessionContext.test.js
```

Expected: renderer recreation erases the textarea and the current attachment button immediately
dispatches a run.

- [ ] **Step 3: Implement renderer-only draft state**

Use bounded Maps keyed by session ID and settings entity key. Cap composer drafts at 8,192 bytes
using the shared public constant exposed as a non-secret snapshot limit or a duplicate assertion
tested against the main constant. Retain at most 32 session drafts and delete oldest entries.

- [ ] **Step 4: Render the staged attachment chip**

Render:

```html
<div class="attachment-chip">
  <span>notes.md · 12 KB</span>
  <button type="button" aria-label="Remove notes.md">Remove</button>
</div>
```

Rename the action to `Attach file`. Add helper copy listing “Text, code, configuration, Markdown,
CSV, JSON, and logs · 48 KiB maximum.” Disable choose/remove while a run is busy.

- [ ] **Step 5: Separate provider and visible retry requests**

Change `createVisibleRequestTracker` to store:

```js
{ text, attachment }
```

Validate the goal and internal attachment shape before assignment. Submission consumes the pending
attachment and passes it separately to `promptController`. Extend the coordinator/session-context
builder to escape the attachment as untrusted data in the current provider request, prune older
history to remain at or below 65,536 bytes, and persist only:

```text
<user text>

[Attached file: notes.md]
```

The combined visible turn must still fit `MAX_GOAL_BYTES`; otherwise reject before reservation.
Retry uses the stored in-memory object without reopening a path. No attachment content enters the
encrypted session store.

- [ ] **Step 6: Add visible bounded feedback**

Keep `#app-status` as `aria-live="polite"` but render a visible `.app-feedback` banner for pending,
success, and failure. Limit copy to public error fields, add Dismiss, and preserve draft text after
failure/cancel.

- [ ] **Step 7: Run focused tests and witness GREEN**

Run the Step 2 command.

Expected: drafts survive snapshots, attachment metadata is safe, Send/Retry use the correct
separate values, and feedback is visible.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- src/app/draftState.js src/app/index.html src/app/app.js src/app/conversation.js src/app/app.css src/appWindow.js src/main.js src/promptController.js src/agent/sessionCoordinator.js src/agent/sessionContext.js tests/appDraftState.test.js tests/appConversation.test.js tests/appRenderer.test.js tests/appLifecycle.test.js tests/promptIntegration.test.js tests/sessionCoordinator.test.js tests/sessionContext.test.js
git commit -m "feat: add draft-safe file composer"
```

---

### Task 3: Agent settings and provider connection editor

**Files:**
- Modify: `src/app/settings.js`
- Modify: `src/app/app.js`
- Modify: `src/app/app.css`
- Modify: `src/agent/sessionCoordinator.js`
- Modify: `src/app/appSnapshot.js`
- Modify: `tests/appSettings.test.js`
- Modify: `tests/appRenderer.test.js`
- Modify: `tests/settingsPresentation.test.js`
- Modify: `tests/sessionCoordinator.test.js`
- Modify: `tests/appSnapshot.test.js`

**Interfaces:**
- Consumes: `draftState`, existing `update-agent`, `set-participant-connection`,
  `save-connection`, `test-connection`, `begin-provider-setup`, and `choose-directory`.
- Produces: keyboard-accessible `Agent settings` / `Session settings` tabs.
- Produces: public `activeAgentProfile: { id, name, marker, instruction }` with only the selected
  agent's bounded user-authored instruction and no encrypted field.
- Provider drafts map `codex-cli` and `claude-code-cli` to exact allowlisted registries.

- [ ] **Step 1: Write failing tab and agent-editor tests**

Assert:

- tab buttons have `role="tab"`, `aria-selected`, and matching tab panels;
- Agent settings is initially selected;
- active agent name/instruction save dispatches exact `update-agent`;
- a snapshot rerender preserves dirty fields;
- instruction byte count rejects over 2,000 UTF-8 bytes before dispatch.

Add coordinator/snapshot coverage proving only the selected agent's decrypted, bounded profile
reaches `activeAgentProfile`; encrypted instruction ciphertext and other agents' instructions
remain absent.

- [ ] **Step 2: Write failing provider-editor tests**

For Codex, assert exact GPT-5.6 models and efforts. For Claude, assert only `fable`, `opus`,
`sonnet` and supported efforts from `claudeModels.js`. Both must force Full Computer, show the
permanent warning, expose Test/official sign-in, and never offer Workspace fallback.

- [ ] **Step 3: Run focused Settings tests and witness RED**

```powershell
node --test tests/appSettings.test.js tests/appRenderer.test.js tests/settingsPresentation.test.js tests/sessionCoordinator.test.js tests/appSnapshot.test.js
```

Expected: one long undifferentiated page, no active-agent editor, and Codex-only setup.

- [ ] **Step 4: Build Agent settings**

Render sections in this order:

1. Active agent profile.
2. Assigned connection for this session.
3. Provider connections.
4. Add/edit Codex or Claude Code connection.
5. Agent library.

Use explicit labels for every input. Save only from explicit form submission. Busy state disables
mutations but not reading/copying settings.

- [ ] **Step 5: Build the provider-aware editor**

Changing provider resets model/effort to that provider's default. Edit retains the saved provider
type and exact ID. Folder Browse calls `choose-directory` and updates the draft only when a path is
returned. Test and sign-in always include the saved connection ID.

- [ ] **Step 6: Preserve focus and drafts**

Arrow Left/Right switches tabs, Home/End select first/last, and focus moves to the selected tab.
Snapshot updates retain dirty agent/connection drafts; successful Save resets them from the new
snapshot.

- [ ] **Step 7: Run focused tests and witness GREEN**

Run the Step 3 command.

Expected: all Agent settings, provider registry, draft, focus, and action routing cases pass.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- src/app/settings.js src/app/app.js src/app/app.css src/agent/sessionCoordinator.js src/app/appSnapshot.js tests/appSettings.test.js tests/appRenderer.test.js tests/settingsPresentation.test.js tests/sessionCoordinator.test.js tests/appSnapshot.test.js
git commit -m "feat: organize agent and provider settings"
```

---

### Task 4: Session settings and sidebar management

**Files:**
- Modify: `src/app/settings.js`
- Modify: `src/app/sidebar.js`
- Modify: `src/app/app.js`
- Modify: `src/app/app.css`
- Modify: `tests/appSettings.test.js`
- Modify: `tests/appPresentation.test.js`
- Modify: `tests/appRenderer.test.js`
- Modify: `tests/appWindow.test.js`

**Interfaces:**
- Consumes: existing `rename-session`, `remove-participant`, `select-participant`,
  `add-participant`, and main-owned `confirm-delete-session`.
- Produces: Session details, Participants, and Danger zone.

- [ ] **Step 1: Write failing session-management tests**

Assert Session settings shows title, workspace, updated time, participant names/connections, and
non-final participant removal. Rename dispatches exact `{ sessionId, title }`. Delete routes only
through `confirm-delete-session`, never directly through `delete-session`.

Assert sidebar exposes a compact selected-session menu for Rename and Delete without making every
row visually noisy.

- [ ] **Step 2: Run focused session UI tests and witness RED**

```powershell
node --test tests/appSettings.test.js tests/appPresentation.test.js tests/appRenderer.test.js tests/appWindow.test.js
```

Expected: backend intents exist but no UI exposes them.

- [ ] **Step 3: Implement Session settings**

Render:

- Session details form with explicit Save name;
- read-only workspace and last-updated information;
- participant rows with assigned connection and active marker;
- eligible-agent Add action;
- red-bordered Danger zone with `Delete session`.

Use plain copy explaining that removing a participant preserves attributed history.

- [ ] **Step 4: Implement selected-session menu**

Add one overflow button only on the selected session. Use `aria-haspopup="menu"` and keyboard
Escape dismissal. Rename focuses Session settings title; Delete invokes the main-owned confirmation.

- [ ] **Step 5: Handle empty post-delete state**

After deleting the last session, show one clear `New session` action using an existing agent and
saved connection. Do not delete agents or connections automatically.

- [ ] **Step 6: Run focused tests and witness GREEN**

Run the Step 2 command.

Expected: session actions are usable, guarded, and keyboard accessible.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/app/settings.js src/app/sidebar.js src/app/app.js src/app/app.css tests/appSettings.test.js tests/appPresentation.test.js tests/appRenderer.test.js tests/appWindow.test.js
git commit -m "feat: add scoped session settings"
```

---

### Task 5: Responsive visual gate and account-free workflow

**Files:**
- Modify: `src/app/app.css`
- Modify: `scripts/capture_app_layout.js`
- Modify: `scripts/capture_app_e2e.js`
- Create: `docs/evidence/security-ui-conversation-900x650.png`
- Create: `docs/evidence/security-ui-conversation-1440x900.png`
- Create: `docs/evidence/security-ui-agent-settings-900x650.png`
- Create: `docs/evidence/security-ui-agent-settings-1440x900.png`
- Create: `docs/evidence/security-ui-session-settings-900x650.png`
- Create: `docs/evidence/security-ui-session-settings-1440x900.png`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Produces: durable screenshot and walkthrough evidence.

- [ ] **Step 1: Add visual assertions before CSS changes**

Extend layout capture to report viewport/scroll dimensions, selected Settings tab, visible feedback,
attachment chip metadata, focused element, and horizontal overflow. Add assertions for exact
900×650 and 1440×900 viewport equality and no document-level horizontal scroll.

- [ ] **Step 2: Run layout capture and witness any RED assertions**

Launch an isolated test profile with the repository's deterministic Offline Demo executor and a
unique prompt/debug port. Run the updated capture script.

Expected before final CSS: at least the new tab/chip selectors or overflow assertions fail.

- [ ] **Step 3: Finish the responsive visual hierarchy**

Keep one warm accent, existing dark neutral palette, 8 px rhythm, 40 px minimum controls, visible
focus rings, and no gradients/glass/dashboard styling. At narrow width, keep Settings tabs sticky,
forms single-column, and destructive actions separated from primary Save.

- [ ] **Step 4: Run the account-free walkthrough**

Using a fresh isolated profile and a disposable workspace:

1. Browse for a project folder.
2. Create the Offline Demo agent/session and complete a first task.
3. Type an unsent draft and trigger a snapshot update; verify it remains.
4. Stage an allowlisted file; verify chip basename/size and no immediate run.
5. Send a question with the attachment and verify visible metadata.
6. Edit the active agent instruction.
7. Rename the session.
8. Add/remove a participant while preserving history.
9. Restart and verify encrypted restore.
10. Confirm session deletion and verify the empty recovery action.

- [ ] **Step 5: Capture all required screenshots**

Capture conversation with staged attachment, Agent settings, and Session settings at both required
viewports. Inspect every PNG directly for clipping, weak hierarchy, unreadable contrast, misleading
security copy, and accidental paths/secrets.

- [ ] **Step 6: Run complete verification**

```powershell
npm.cmd test
python -m pytest -q
npm.cmd run package:win
npm.cmd run verify:package
git diff --check
```

Expected: zero test failures, successful package verification, and clean diff check.

- [ ] **Step 7: Verify protected paths**

```powershell
git diff --name-only f2ce720...HEAD
git status --short
```

Expected: no `.workbuddy-ai/`, `LOCAL_PR.html`, or desktop JSON in the branch diff or index.

- [ ] **Step 8: Update canonical evidence and commit**

Record exact test counts, package file/byte totals, screenshot paths, and walkthrough result in
`docs/BUILD_LOG.md`. Refresh `PROJECT_CHECKLIST.html`.

```powershell
git add -- src/app/app.css scripts/capture_app_layout.js scripts/capture_app_e2e.js docs/evidence/security-ui-*.png docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git commit -m "docs: verify security UI hardening"
```
