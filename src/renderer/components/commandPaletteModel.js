// Command-palette model — the pure, framework-free brain behind the Phase 3 command
// palette (design 3.7: `Ctrl+K` opens a keyboard-first palette that carries actions,
// not just navigation: switch agent / session / connection; re-run with edits; open
// the project folder; copy a diff; export the session).
//
// Every palette entry is a *command descriptor* that states the EXACT target it will
// act on (the `detail` field) and carries a fully-resolved `action`. The model never
// executes anything — the live controller / app executor interprets `action.kind`
// (see commandPaletteController.js + app.js). Keeping all derivation here means the
// live vanilla-DOM palette and the Preact CommandPalette.mjs component can never drift.
//
// Dual-mode: loaded as a classic <script> (exposes globalThis.claudePetCommandPaletteModel)
// and require()able in Node for tests. No ESM, no Preact, no DOM here.

'use strict';

// --- snapshot accessors (defensive against partial snapshots) ---------------------

function activeSessionId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const fromSelection = snapshot.selection?.sessionId;
  if (typeof fromSelection === 'string' && fromSelection) return fromSelection;
  const fromSession = snapshot.session?.id;
  return typeof fromSession === 'string' && fromSession ? fromSession : null;
}

function activeAgentId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const fromAgent = snapshot.activeAgent?.id;
  if (typeof fromAgent === 'string' && fromAgent) return fromAgent;
  const fromSelection = snapshot.selection?.agentId;
  return typeof fromSelection === 'string' && fromSelection ? fromSelection : null;
}

function agentsOfSnapshot(snapshot) {
  return Array.isArray(snapshot?.agents) ? snapshot.agents : [];
}
function sessionsOfSnapshot(snapshot) {
  return Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
}
function connectionsOfSnapshot(snapshot) {
  return Array.isArray(snapshot?.connections) ? snapshot.connections : [];
}

// The active session's participant list (objects of { agentId, connectionId }).
function activeParticipants(snapshot) {
  const sid = activeSessionId(snapshot);
  const session = sessionsOfSnapshot(snapshot).find((item) => item.id === sid)
    || snapshot?.session
    || null;
  return Array.isArray(session?.participants) ? session.participants : [];
}

function activeParticipant(snapshot) {
  const aid = activeAgentId(snapshot);
  const participants = activeParticipants(snapshot);
  return participants.find((item) => item.agentId === aid) || participants[0] || null;
}

function agentName(snapshot, agentId) {
  const agent = agentsOfSnapshot(snapshot).find((item) => item.id === agentId);
  return agent?.name || agentId || 'Unknown agent';
}
function connectionLabel(snapshot, connectionId) {
  const conn = connectionsOfSnapshot(snapshot).find((item) => item.id === connectionId);
  return conn ? `${conn.label} · ${conn.modelId}` : (connectionId || 'Unknown connection');
}

function truncate(text, max = 72) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// --- command derivation ----------------------------------------------------------

// One command descriptor:
//   { id, kind, title, detail, action }
// `action.kind` is one of: 'intent' | 'reopen-goal' | 'open-folder' | 'copy-diff' | 'export-session'.
// `action.intent` (for 'intent') is exactly the { type, data } the app dispatches via bridge.intent.

function switchAgentCommands(snapshot) {
  const aid = activeAgentId(snapshot);
  const sid = activeSessionId(snapshot);
  if (!sid) return [];
  const commands = [];
  for (const participant of activeParticipants(snapshot)) {
    if (participant.agentId === aid) continue; // don't offer the already-active agent
    commands.push({
      id: `agent:${participant.agentId}`,
      kind: 'switch-agent',
      title: 'Switch agent',
      detail: agentName(snapshot, participant.agentId),
      action: {
        kind: 'intent',
        intent: { type: 'select-participant', data: { sessionId: sid, agentId: participant.agentId } },
      },
    });
  }
  return commands;
}

function switchSessionCommands(snapshot) {
  const sid = activeSessionId(snapshot);
  const commands = [];
  for (const session of sessionsOfSnapshot(snapshot)) {
    if (session.id === sid) continue; // don't re-select the current session
    commands.push({
      id: `session:${session.id}`,
      kind: 'switch-session',
      title: 'Switch session',
      detail: session.title || session.id,
      action: { kind: 'intent', intent: { type: 'select-session', data: { sessionId: session.id } } },
    });
  }
  return commands;
}

function switchConnectionCommands(snapshot) {
  const participant = activeParticipant(snapshot);
  const sid = activeSessionId(snapshot);
  if (!participant || !sid) return [];
  const commands = [];
  for (const conn of connectionsOfSnapshot(snapshot)) {
    if (conn.id === participant.connectionId) continue; // already using this connection
    commands.push({
      id: `connection:${conn.id}`,
      kind: 'switch-connection',
      title: 'Switch connection',
      detail: connectionLabel(snapshot, conn.id),
      action: {
        kind: 'intent',
        intent: {
          type: 'set-participant-connection',
          data: { sessionId: sid, agentId: participant.agentId, connectionId: conn.id },
        },
      },
    });
  }
  return commands;
}

// "Re-run with edits" — one command per past user goal. Seeding the composer is done
// by the executor (reopen-goal); the model only carries the exact goal text. Capped to
// the most recent goals so the palette stays responsive on long sessions.
function rerunCommands(snapshot, limit = 15) {
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
  const goals = [];
  for (const turn of turns) {
    if (turn?.role === 'user' && typeof turn.text === 'string' && turn.text.trim()) {
      goals.push({ id: turn.id || `goal-${goals.length}`, text: turn.text });
    }
  }
  // Most recent goals first (turns are chronological, so read from the end).
  goals.reverse();
  return goals.slice(0, limit).map((goal) => ({
    id: `rerun:${goal.id}`,
    kind: 're-run',
    title: 'Re-run with edits',
    detail: truncate(goal.text),
    action: { kind: 'reopen-goal', text: goal.text },
  }));
}

function openFolderCommands(snapshot) {
  const path = snapshot?.session?.workspacePath || null;
  if (!path || typeof path !== 'string' || !path.trim()) return [];
  return [{
    id: 'open-folder',
    kind: 'open-folder',
    title: 'Open project folder',
    detail: path,
    action: { kind: 'open-folder', path },
  }];
}

// "Copy a diff" — copies the most recent run's concatenated unified diff. The model
// precomputes the diff text; the executor just writes it to the clipboard.
function copyDiffCommands(snapshot) {
  const diff = latestRunDiff(snapshot);
  if (!diff) return [];
  return [{
    id: 'copy-diff',
    kind: 'copy-diff',
    title: 'Copy latest diff',
    detail: truncate(diff.split('\n').find((line) => line.startsWith('diff')) || 'Unified diff', 72),
    action: { kind: 'copy-diff', text: diff },
  }];
}

// "Export session" — downloads the session as a local Markdown run log. The markdown is
// produced by exportSessionMarkdown (also reused by the dedicated export task 3.8); the
// executor performs the client-side download.
function exportCommands(snapshot) {
  const sid = activeSessionId(snapshot);
  if (!sid) return [];
  const title = snapshot?.session?.title
    || sessionsOfSnapshot(snapshot).find((item) => item.id === sid)?.title
    || 'session';
  return [{
    id: 'export-session',
    kind: 'export-session',
    title: 'Export session',
    detail: title,
    action: { kind: 'export-session', sessionId: sid },
  }];
}

// Builds the full, ordered command list for a snapshot. Order groups related actions
// together (navigation first, then per-run actions) so keyboard users can predict it.
function buildCommands(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  return [
    ...switchAgentCommands(snapshot),
    ...switchSessionCommands(snapshot),
    ...switchConnectionCommands(snapshot),
    ...rerunCommands(snapshot),
    ...openFolderCommands(snapshot),
    ...copyDiffCommands(snapshot),
    ...exportCommands(snapshot),
  ];
}

// --- filtering / ranking ---------------------------------------------------------

// Scores one command against a lower-cased query. 0 = no match.
//   title prefix > title substring > detail substring.
function scoreCommand(command, query) {
  const q = query.trim();
  if (!q) return 1; // empty query keeps natural order with neutral score
  const title = (command.title || '').toLowerCase();
  const detail = (command.detail || '').toLowerCase();
  if (title.startsWith(q)) return 4;
  if (title.includes(q)) return 3;
  if (detail.includes(q)) return 2;
  return 0;
}

function filterCommands(commands, query) {
  const list = Array.isArray(commands) ? commands : [];
  const q = (typeof query === 'string' ? query : '').toLowerCase();
  if (!q.trim()) return list.slice();
  const scored = [];
  list.forEach((command, index) => {
    const score = scoreCommand(command, q);
    if (score > 0) scored.push({ command, score, index });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((entry) => entry.command);
}

// Keyboard navigation: wraps around the ends. Returns a safe index for the given delta.
function moveSelection(items, currentIndex, delta) {
  const length = Array.isArray(items) ? items.length : 0;
  if (length === 0) return -1;
  const base = Number.isFinite(currentIndex) ? currentIndex : -1;
  const next = base + (Number.isFinite(delta) ? delta : 0);
  // Wrap into [0, length).
  return ((next % length) + length) % length;
}

// --- diff + markdown export helpers ----------------------------------------------

// Concatenates the unified diffs of the most recent run that produced file changes.
// Traces are derived from snapshot.activity.events (file events carry `diff`).
function latestRunDiff(snapshot) {
  const events = Array.isArray(snapshot?.activity?.events) ? snapshot.activity.events : [];
  const fileEvents = events.filter((event) => event?.kind === 'file' && typeof event.diff === 'string' && event.diff);
  if (fileEvents.length === 0) return '';
  return fileEvents.map((event) => event.diff).join('\n');
}

// Builds a local Markdown run log: goals, steps, diffs, and answers. No cloud, no
// network, no telemetry (per design 3.8). Reused by the palette executor and, later,
// the dedicated export-session task.
function exportSessionMarkdown(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  const sessionTitle = snapshot.session?.title
    || sessionsOfSnapshot(snapshot).find((s) => s.id === activeSessionId(snapshot))?.title
    || 'Session';
  const lines = [`# ${sessionTitle}`, ''];

  let goalText = null;
  for (const turn of turns) {
    if (turn?.role === 'user') {
      goalText = turn.text || '';
      lines.push(`## Goal`, '', goalText, '');
    } else if (turn?.role === 'assistant') {
      lines.push('### Answer', '', turn.text || '', '');
    }
  }

  const events = Array.isArray(snapshot.activity?.events) ? snapshot.activity.events : [];
  const fileEvents = events.filter((event) => event?.kind === 'file' && typeof event.diff === 'string' && event.diff);
  if (fileEvents.length > 0) {
    lines.push('## Diffs', '');
    for (const event of fileEvents) {
      lines.push(`\`\`\`diff\n${event.diff}\n\`\`\``, '');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const commandPaletteModel = Object.freeze({
  activeSessionId,
  activeAgentId,
  activeParticipants,
  activeParticipant,
  buildCommands,
  filterCommands,
  scoreCommand,
  moveSelection,
  latestRunDiff,
  exportSessionMarkdown,
  truncate,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = commandPaletteModel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.claudePetCommandPaletteModel = commandPaletteModel;
}
