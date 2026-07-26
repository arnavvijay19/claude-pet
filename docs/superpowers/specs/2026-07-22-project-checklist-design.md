# Disposable Project Checklist Design

> **HISTORICAL / COMPLETED — DO NOT EXECUTE.** This document records the original Tasks 1-15
> checklist design only. The current canonical sequence is Tasks 13-21 in
> [`../plans/2026-07-13-claude-pet.md`](../plans/2026-07-13-claude-pet.md), and the current
> `PROJECT_CHECKLIST.html` remains in use through Task 21. Do not regenerate it from this file or
> delete it after the superseded Task 15.

**Date:** 2026-07-22  
**Status:** Historical — implementation completed and later superseded

## Purpose

Create one beginner-friendly HTML to-do list for Claude Pet. Each item tells the user what remains,
why it matters, and what the user personally needs to do. The same list tracks Tasks 1-15 and the
small user tests needed along the way.

The checklist is a temporary coordination aid. It must be safe to delete after Task 15 is complete
and verified. It does not replace the canonical implementation plan, specifications, build log, or
final Task 15 README.

## Location and format

Create `PROJECT_CHECKLIST.html` at the repository root. The file must be self-contained, with its
HTML, CSS, and JavaScript together and no external packages, fonts, images, servers, or network
requests. The user can open it by double-clicking it in Windows.

## Page structure

The page contains one checklist with:

1. A short **Start Here** box showing the next thing to do.
2. One item for each project Task 1-15. Each item has a checkbox, a plain-English explanation, and a
   short **What you need to do** line. Tasks that need no user action say so.
3. Small user-test items directly beneath the task that creates the feature. These explain exactly
   what to click or look for without pretending unfinished features already work.
4. One notes box for the user or an AI to record a blocker or next step.
5. A short final item explaining that the file can be deleted after Task 15 is verified.

There is no separate dashboard, export system, technical architecture guide, or full user manual.

## Interaction and saved state

- Every checklist item uses a real HTML checkbox.
- Checkbox state and editable notes save automatically to browser `localStorage`.
- Stable item IDs preserve saved state when an AI edits explanations.
- A simple completed/total count updates after a checkbox change.
- A **Reset checklist** button clears browser-saved values and restores the file's canonical
  defaults after a confirmation prompt.
- The page works when opened through a local `file://` URL.

## Canonical state and AI updates

The HTML source holds canonical default completion state. Tasks 1-5 begin checked and Task 6 is the
next task; later tasks begin unchecked. Browser-saved user state is personal and must never be
treated as proof that repository work is complete.

An AI updating the file must first verify the canonical plan, `docs/project-context.md`,
`docs/BUILD_LOG.md`, current Git state, and relevant test evidence. It may then check completed
defaults, change the Start Here item, and improve explanations. A short comment at the top of the
HTML records these rules; the visible page does not burden the user with AI workflow details.

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
5. Verify reset restores canonical defaults.
6. Verify no external URLs, network requests, credentials, or executable command paths exist.
7. Verify the displayed project state matches the current canonical repository documents.
8. Verify every unfinished task clearly says what the user needs to do, including when the answer is
   "nothing yet."
9. Run `git diff --check` and confirm no unrelated files changed.
