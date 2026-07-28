# Claude Pet Core V1 UX Rebuild

**Status:** Proposed implementation design
**Date:** 2026-07-27

## Goal

Make Claude Pet feel like a small, dependable desktop agent rather than a collection of
engineering controls. A new user must be able to configure the Offline Demo, start a task,
watch useful progress, read the result, continue the same session, stop a run, recover from
failure, and find advanced settings without learning the internal architecture.

The existing provider, permission, session, activity, attachment, and execution boundaries
remain authoritative. This redesign changes their presentation and fixes user-facing lifecycle
gaps; it does not weaken Full Computer warnings or pretend unavailable Workspace isolation works.

## Reference audit

The design borrows interaction patterns, not source code or visual assets:

- [OpenChamber](https://github.com/openchamber/openchamber): session navigation, central task
  timeline, inline work summaries, and an optional contextual side panel.
- [CloudCLI](https://github.com/siteboon/claudecodeui): project-grouped sessions, persistent
  composer, expandable tool cards, and advanced controls kept in Settings.
- [Hermes Desktop](https://github.com/NousResearch/hermes-agent/tree/main/apps/desktop):
  one continuous chat surface, structured live tool activity, project-based workspaces, and
  side-by-side previews.
- [Coworker](https://github.com/accomplish-ai/coworker): task-first local desktop-agent
  positioning and onboarding before advanced configuration.

CloudCLI is AGPL-licensed, so Claude Pet must not copy its implementation. The useful ideas are
common interaction patterns and will be implemented independently in the existing vanilla
Electron architecture.

## Chosen product shape

Claude Pet will use one normal, resizable main window. The animated pet remains the lightweight
launcher and status indicator; clicking it, choosing the tray action, or starting a task opens
the same main window.

The current Settings window and Response popup will not remain separate primary workflows.
Settings becomes a secondary view inside the main window. The old response popup is retired after
feature parity is proven.

### Main window

The default layout has two columns:

1. A narrow sidebar for the current agent and its sessions.
2. A flexible conversation workspace for the selected session.

A temporary right-side Activity drawer may open when requested. It is not visible by default and
must not shrink the conversation below a usable width.

### Sidebar

The sidebar contains:

- product identity and a prominent New session action;
- agents with their sessions grouped underneath;
- the selected session, latest status, and relative update time;
- rename and delete actions in a small context menu;
- a Settings action fixed at the bottom.

Agents and sessions are created inline. Native prompt dialogs are removed from the normal flow.
The selected workspace belongs to the session and is shown in plain language.

### Conversation workspace

The header shows:

- session title;
- active provider and model;
- workspace name;
- one permanent access badge: `Workspace only` or `Full computer access`.

The timeline shows user goals and assistant responses as readable turns. Agent actions appear
between them as compact status cards such as `Read 3 files`, `Updated README.md`, or
`Command failed`. Cards expand to sanitized detail on demand. Raw event schemas, executor IDs,
token fields, and internal phase names are hidden from the default view.

The composer stays attached to the bottom and supports:

- multiline text;
- deliberate UTF-8 text attachment;
- Send while idle;
- Stop while running;
- a clear disabled reason when no runnable provider/session exists.

A successful, failed, or stopped run always ends in an actionable state. The user can retry,
continue, open Settings, or dismiss the status. Failure and stopped states must never create an
undismissable always-on-top window.

### Activity drawer

The drawer replaces `Simple` and `Comprehensive`.

Its default summary shows elapsed time, current action, changed files, provider/model, and access
scope. An Advanced section exposes the complete sanitized event timeline for diagnosis. The same
state drives both views, but the UI subscribes once rather than rendering duplicate IPC events and
polling every second.

### Settings

Settings is organized into:

- **Connections:** Offline Demo, Codex, and Claude Code connections.
- **Access:** workspace path and the exact permission boundary.
- **Model:** provider-specific model and effort.
- **Advanced:** sign-in, connection testing, and diagnostics.

The default path is a short guided connection editor. Terms such as `executor`,
`permission profile`, and `bounded visible history` are replaced with user language. Security
warnings remain explicit and cannot be bypassed through renderer state.

## First-run and empty states

On first launch, Claude Pet creates or offers one obvious Offline Demo setup:

1. Choose a folder.
2. Confirm `Workspace only`.
3. Start the first task.

The user does not manually create a connection, then an agent, then a session, then select a next
provider before discovering the goal box. Advanced real-provider setup remains available after the
first runnable experience.

Every empty state contains one valid next action. No empty select element or unexplained disabled
button is presented as a workflow.

## Runtime and data flow

The existing main-owned stores and coordinator remain the source of truth.

1. Main publishes one immutable `app:snapshot` containing public navigation, session, run, and
   presentation-safe activity state.
2. The renderer sends narrow intent messages such as select session, submit goal, stop, retry,
   create session, or save connection.
3. Main validates sender, payload, busy state, session ownership, provider compatibility, and
   Full Computer authorization exactly as it does today.
4. Main applies the mutation and publishes the next snapshot.
5. Renderer components render only from that snapshot and keep no security-authoritative state.

This creates one UI state path instead of separate Settings snapshots, response state/activity
events, and timer polling.

## Error handling

- Every rejected action produces a nearby plain-language message with a recovery action.
- Save, setup, test, send, stop, retry, and delete operations have visible pending states.
- Connection and session changes remain atomic while a run is busy.
- Long answers and long activity histories scroll within the window and never overflow a fixed
  transparent popup.
- Closing the main window hides it to the tray; it does not discard the active run.
- Crashes or reloads restore the encrypted selected agent/session and bounded visible history.

## Visual baseline

- Native resizable framed window, approximately 1080 × 720 by default.
- Dark neutral palette matching the pet artwork, with one warm accent and restrained status colors.
- 14–16 px system typography, 8 px spacing rhythm, clear focus rings, and at least 40 px primary
  controls.
- Borders and cards are used only to communicate grouping or state.
- No gradients, glass effects, oversized headings, decorative dashboards, or dense metadata grids.
- Both 900 × 650 and 1440 × 900 layouts must remain usable without clipped controls.

## Delivery sequence

1. Add failing lifecycle tests for failure/stopped dismissal, long-content containment, session
   continuation, and first-run usability.
2. Introduce the unified public app snapshot and intent IPC without removing existing windows.
3. Build the main shell, sidebar, conversation timeline, composer, and inline activity cards.
4. Move connection/access/model controls into secondary Settings.
5. Wire pet and tray actions to the main window.
6. Run an Offline Demo end-to-end gate covering first run, follow-up, attachment, Stop, failure,
   retry, restart, rename/delete, and window close/reopen.
7. Remove the old response popup and legacy Settings workflow only after parity and regression
   evidence pass.

## Acceptance criteria

- A clean profile reaches a successful Offline Demo task without undocumented prerequisites.
- The same window supports a follow-up in the same encrypted session.
- Running, success, failure, and stopped states all have correct controls and recovery paths.
- Long text and at least 100 activity events remain navigable without clipping.
- Provider, workspace, and Full Computer warnings remain accurate across session switching.
- Keyboard navigation covers sidebar, timeline actions, composer, drawer, dialogs, and Settings.
- Existing security, provider, session, attachment, packaging, and animation tests remain green.
- Fresh visual evidence shows the main workflow at 900 × 650 and 1440 × 900.

## Explicitly deferred

Multi-agent parallel runs, terminals, Git/diff management, voice, cloud sync, remote access,
plugins, schedules, and a three-pane IDE layout are not part of this rebuild. They appear in the
reference apps but would make Claude Pet less reliable and less minimal at this stage.
