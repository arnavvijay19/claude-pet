# Interactive Project Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a disposable, self-contained HTML to-do list that explains Claude Pet Tasks 1-15 and tells the user exactly what they need to do.

**Architecture:** A single root-level `PROJECT_CHECKLIST.html` contains all markup, styling, task data, and behavior. JavaScript renders a fixed task array, stores checkbox and notes state in `localStorage`, updates a completed count, and restores canonical defaults after confirmation.

**Tech Stack:** HTML5, CSS, browser JavaScript, `localStorage`; no dependencies or network access.

## Global Constraints

- Create only `PROJECT_CHECKLIST.html` for the product-facing artifact.
- Keep the page usable through a local `file://` URL.
- Use no external packages, fonts, images, servers, or network requests.
- Tasks 1-5 default to complete; Task 6 is the next task; Tasks 6-15 default incomplete.
- Every task has a plain-English explanation and a `What you need to do` instruction.
- Never store credentials, account identifiers, prompt contents, or private file paths.
- The file remains non-canonical and safe to delete after Task 15 is verified.

---

### Task 1: Build and verify the interactive checklist

**Files:**
- Create: `PROJECT_CHECKLIST.html`
- Reference only: `docs/project-context.md`
- Reference only: `docs/BUILD_LOG.md`
- Reference only: `docs/superpowers/plans/2026-07-13-claude-pet.md`

**Interfaces:**
- Consumes: canonical task completion and user-test requirements from the three reference files.
- Produces: a local HTML page with checkbox state under `claude-pet-project-checklist-v1` and notes under the same stored object.

- [x] **Step 1: Establish a failing artifact check**

Run this before creating the file:

```powershell
Test-Path -LiteralPath PROJECT_CHECKLIST.html
```

Expected: `False`.

- [x] **Step 2: Create the complete standalone page**

Create `PROJECT_CHECKLIST.html` with these exact components:

```html
<main class="page">
  <header>
    <p class="eyebrow">Claude Pet</p>
    <h1>Project to-do list</h1>
    <p>A simple list of what is finished, what comes next, and what you need to do.</p>
  </header>
  <section class="start-here" aria-labelledby="start-title">
    <h2 id="start-title">Start here</h2>
    <p><strong>Next:</strong> Task 6 — build the agent manager and safe activity foundation.</p>
    <p><strong>Your job:</strong> Ask an AI to execute Task 6 only. You do not need an AI account for Tasks 6-9.</p>
  </section>
  <section aria-labelledby="todo-title">
    <div class="section-heading">
      <h2 id="todo-title">To-do list</h2>
      <output id="progress" aria-live="polite"></output>
    </div>
    <ol id="task-list" class="task-list"></ol>
  </section>
  <section aria-labelledby="notes-title">
    <h2 id="notes-title">Notes or blockers</h2>
    <textarea id="notes" rows="6" placeholder="Write the next step or anything that is stuck..."></textarea>
  </section>
  <footer>
    <button id="reset" type="button">Reset checklist</button>
    <p>This page is only a helper. The project files are the official record, and this file can be deleted after Task 15 is verified.</p>
  </footer>
</main>
```

Define a `TASKS` array with 15 stable IDs (`task-1` through `task-15`). Every object contains `title`, `done`, `explanation`, and `action`. Use canonical completion defaults and cover these user actions:

- Tasks 1-5: completed foundations; no further user action.
- Task 6: ask an AI to execute only Task 6 and verify tests/commit.
- Task 7: no manual action; AI verifies secure storage boundaries.
- Task 8: no account needed; AI builds the Offline Demo executor.
- Task 9: launch the app, create Offline Demo, choose a test workspace, submit a goal, inspect the response, and approve the gate.
- Task 10: update/install Codex CLI `>=0.144.6` before its optional real probe.
- Task 11: optionally sign into Codex officially, run one disposable-workspace goal, and inspect Comprehensive activity.
- Task 12: optionally sign into Claude Code `>=2.1.217`, run one disposable-workspace goal, and inspect diagnostics/activity.
- Task 13: test cancel/accept behavior of the Full Computer native warning and visible badge.
- Task 14: test a terminal goal, deliberate UTF-8 text-file drop, Stop, switching, and Offline Demo end-to-end.
- Task 15: launch the clean packaged build, acknowledge the unsigned SmartScreen warning, test Offline Demo, and keep the final package/hash.

Render each task as a real `<input type="checkbox">` inside a `<li>`. Use `<label>`, an explanation paragraph, and a visibly labeled action paragraph. Completed items receive a `complete` class.

Use these complete behavior functions:

```js
const STORAGE_KEY = 'claude-pet-project-checklist-v1';

function readSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeSavedState() {
  const checked = {};
  document.querySelectorAll('[data-task-id]').forEach((input) => {
    checked[input.dataset.taskId] = input.checked;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    checked,
    notes: document.querySelector('#notes').value,
  }));
}

function updateProgress() {
  const inputs = [...document.querySelectorAll('[data-task-id]')];
  const complete = inputs.filter((input) => input.checked).length;
  document.querySelector('#progress').textContent = `${complete} of ${inputs.length} complete`;
  inputs.forEach((input) => input.closest('li').classList.toggle('complete', input.checked));
}
```

On startup, render tasks using saved checkbox values when present and canonical `done` defaults otherwise. Restore notes, attach `change` and `input` listeners, and call `updateProgress()`. The Reset button calls `confirm`, removes `STORAGE_KEY` only after acceptance, and reloads the page.

Add an HTML comment instructing AIs to verify the canonical plan, project context, build log, Git state, and test evidence before changing default completion. Add local relative links to those three canonical documents.

Style the page as a readable single-column list with a maximum width, high-contrast focus outlines, large checkbox targets, completed-item dimming without hiding text, responsive spacing, and system fonts. Do not add animations, navigation, tabs, charts, or a dashboard.

- [x] **Step 3: Run static and syntax verification**

Run:

```powershell
Test-Path -LiteralPath PROJECT_CHECKLIST.html
rg -n '<input|type="checkbox"|localStorage|What you need to do|task-15|Reset checklist' PROJECT_CHECKLIST.html
```

Expected: `True`, with all required structures found.

Extract the inline script to a temporary file and run `node --check`; remove the temporary file afterward. Expected: exit code 0 and no syntax errors.

- [x] **Step 4: Verify behavior in a real browser**

Open the local HTML file. Verify:

1. Tasks 1-5 start checked and Tasks 6-15 start unchecked after Reset.
2. The counter starts at `5 of 15 complete`.
3. Checking Task 6 changes the counter to `6 of 15 complete`.
4. Checkbox and notes values remain after reload.
5. Cancelling Reset changes nothing; accepting Reset restores defaults.
6. The browser console shows no errors.

- [x] **Step 5: Run repository safety checks and commit**

Run:

```powershell
rg -n -i 'https?://|fetch\(|XMLHttpRequest|WebSocket|api[_-]?key|bearer |token=' PROJECT_CHECKLIST.html
git diff --check
git status --short
```

Expected: no network/secret-pattern matches, `git diff --check` exits 0, and only the intended checklist and plan/log tracking files are changed.

Commit:

```powershell
git add PROJECT_CHECKLIST.html docs/superpowers/plans/2026-07-22-project-checklist.md
git commit -m "docs: add interactive project checklist"
```
