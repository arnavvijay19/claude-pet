# Disposable Project Checklist Design

**Date:** 2026-07-22  
**Status:** Approved for implementation

## Purpose

Create one beginner-friendly HTML file that serves as both:

- a live development checklist for Claude Pet Tasks 1-15; and
- a simple user manual for launching, configuring, testing, and using the app.

The checklist is a temporary coordination aid. It must be safe to delete after Task 15 is complete
and verified. It does not replace the canonical implementation plan, specifications, build log, or
final Task 15 README.

## Location and format

Create `PROJECT_CHECKLIST.html` at the repository root. The file must be self-contained, with its
HTML, CSS, and JavaScript together and no external packages, fonts, images, servers, or network
requests. The user can open it by double-clicking it in Windows.

## Page structure

The page contains:

1. A prominent **Start Here** card showing the current task and next action.
2. A progress summary with completed and total checklist-item counts.
3. A **Build Progress** section covering Tasks 1-15 in plain language.
4. A **How to Run and Use Claude Pet** section covering launch, tray, Settings, Offline Demo,
   Codex, Claude Code, prompts, file drop, activity views, Stop, and permission modes. Features not
   built yet must be visibly labeled as unavailable until their owning task is complete.
5. A **User Test Gates** section for Tasks 9 and 11-15.
6. Editable **Notes and Blockers** fields.
7. A short **For AI Assistants** section explaining how to update canonical defaults without
   inventing completion claims.
8. A **Project Finished** section that explains when the file may be deleted.

## Interaction and saved state

- Every checklist item uses a real HTML checkbox.
- Checkbox state and editable notes save automatically to browser `localStorage`.
- Stable item IDs preserve saved state when an AI edits labels or adds future detail.
- A progress indicator updates immediately after a checkbox change.
- **Export progress** downloads a small JSON file containing checkbox state and notes.
- **Reset personal progress** clears browser-saved values and restores the file's canonical defaults
  after a confirmation prompt.
- The page works when opened through a local `file://` URL.

## Canonical state and AI updates

The HTML source holds canonical default completion state. Tasks 1-5 begin checked and Task 6 is the
next task; later tasks begin unchecked. Browser-saved user state is personal and must never be
treated as proof that repository work is complete.

An AI updating the file must first verify the canonical plan, `docs/project-context.md`,
`docs/BUILD_LOG.md`, current Git state, and relevant test evidence. It may then update the default
checkbox state, current-task text, instructions, or newly available user features. The checklist
must link to the canonical files and explicitly state that conflicts are resolved in favor of those
files.

## Safety and deletion

- Do not store credentials, API keys, account identifiers, prompt contents, or private file paths.
- Do not execute commands, inspect the filesystem, or make network requests.
- Do not imply unfinished features already work.
- Deleting `PROJECT_CHECKLIST.html` must not affect the app, build, tests, package, or canonical
  documentation.

## Verification

Before handoff:

1. Confirm the file is valid enough to open without console errors in a browser.
2. Verify all checkboxes can be toggled and persist after reload.
3. Verify progress counts update correctly.
4. Verify notes persist.
5. Verify JSON export contains only checklist state and notes.
6. Verify reset restores canonical defaults.
7. Verify no external URLs, network requests, credentials, or executable command paths exist.
8. Verify the displayed project state matches the current canonical repository documents.
9. Run `git diff --check` and confirm no unrelated files changed.

