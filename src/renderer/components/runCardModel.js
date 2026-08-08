// Run-card model — the pure, framework-free brain behind the Phase 3 run cards and
// traces (design 3.3: "Runs, not chat bubbles").
//
// The conversation is a sequence of turns plus a flat list of activity events. This
// module groups those into *runs* (a user goal + the agent's answer + the trace of
// tool actions that happened in between) and derives the view-props every renderer
// needs. It is intentionally dual-mode so the SAME logic powers two renderers in this
// no-bundler Electron app:
//   - the live main window, which loads it as a classic <script> and reads it from
//     globalThis.claudePetRunCardModel (the renderer runs from file:// with no ESM
//     loader, so Preact/htm cannot be used there yet);
//   - the component library + jsdom tests, which import RunCard.mjs / Trace.mjs
//     (ESM/Preact+htm), which re-import the pure functions from here.
//
// Keeping the mapping here means the live vanilla-DOM run cards and the Preact
// components can never drift: they both derive their props from the same functions.

'use strict';

const RUN_CARD_ROLES = Object.freeze({
  USER: 'user',
  AGENT: 'agent',
});

const TRACE_KINDS = Object.freeze({
  FILE: 'file',
  COMMAND: 'command',
  TOOL: 'tool',
  PERMISSION: 'permission',
  NETWORK: 'network',
  USAGE: 'usage',
  MESSAGE: 'message',
  UNKNOWN: 'activity',
});

const FILE_OPERATION_LABELS = Object.freeze({
  read: 'Read',
  create: 'Created',
  modify: 'Modified',
  delete: 'Deleted',
  write: 'Updated',
});

// Maps one activity event to a normalized trace item the card and trace components
// render. `index` is used only to mint a stable key for list rendering. Optional
// fields (command, exitCode, path, operation, decision, permission, diff) are left
// undefined when the event does not carry them, so renderers branch on presence.
function mapEventToTrace(event, index = 0) {
  if (!event || typeof event !== 'object') {
    return {
      id: `evt-${index}`,
      kind: TRACE_KINDS.UNKNOWN,
      label: 'Agent activity',
    };
  }
  const base = {
    id: `evt-${index}`,
    summary: event.summary || null,
    durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
  };
  switch (event.kind) {
    case TRACE_KINDS.FILE: {
      const operation = event.operation || 'read';
      return {
        ...base,
        kind: TRACE_KINDS.FILE,
        operation,
        path: event.path || null,
        label: `${FILE_OPERATION_LABELS[operation] || 'Updated'} ${event.path || 'a file'}`,
        diff: typeof event.diff === 'string' && event.diff.length > 0 ? event.diff : null,
        diffLines: typeof event.diff === 'string' && event.diff.length > 0
          ? event.diff.split('\n').map(parseDiffLine)
          : null,
      };
    }
    case TRACE_KINDS.COMMAND:
      return {
        ...base,
        kind: TRACE_KINDS.COMMAND,
        command: event.command || '',
        exitCode: typeof event.exitCode === 'number' ? event.exitCode : null,
        // Optional captured stdout/stderr. Surfaced by the run scrubber (design
        // 3.5) so a replay can show command output as it stood at each step.
        output: typeof event.output === 'string' && event.output.length > 0 ? event.output : null,
        label: event.command || 'Command',
      };
    case TRACE_KINDS.TOOL:
      return {
        ...base,
        kind: TRACE_KINDS.TOOL,
        toolName: event.toolName || null,
        label: event.toolName ? `Used ${event.toolName}` : 'Used a tool',
      };
    case TRACE_KINDS.PERMISSION:
      return {
        ...base,
        kind: TRACE_KINDS.PERMISSION,
        decision: event.decision || null,
        permission: event.permission || null,
        label: `${event.decision === 'allowed' ? 'Allowed' : 'Denied'} ${event.permission || 'permission'}`,
      };
    case TRACE_KINDS.NETWORK:
      return {
        ...base,
        kind: TRACE_KINDS.NETWORK,
        destination: event.destination || null,
        label: event.destination ? `Network ${event.destination}` : 'Used network access',
      };
    case TRACE_KINDS.USAGE:
      return {
        ...base,
        kind: TRACE_KINDS.USAGE,
        usage: event.usage || null,
        label: event.usage && typeof event.usage.totalTokens === 'number'
          ? `Tokens ${event.usage.totalTokens}`
          : 'Token usage updated',
      };
    case TRACE_KINDS.MESSAGE:
      return {
        ...base,
        kind: TRACE_KINDS.MESSAGE,
        label: event.summary || 'Agent response',
      };
    default:
      return {
        ...base,
        kind: TRACE_KINDS.UNKNOWN,
        status: event.status || null,
        label: event.summary || 'Agent activity',
      };
  }
}

// Splits one unified-diff line into a typed row. Lines are colored by prefix only;
// no third-party syntax highlighter is added (per design 3.3). Structural markup,
// monospace, and +/- line coloring carry it.
function parseDiffLine(line) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return { type: 'meta', text: line };
  }
  if (line.startsWith('@@')) {
    return { type: 'meta', text: line };
  }
  if (line.startsWith('+')) return { type: 'add', text: line };
  if (line.startsWith('-')) return { type: 'del', text: line };
  return { type: 'ctx', text: line };
}

// Collapses a list of activity events into the trace summary the card shows when
// collapsed: step count, file-change count, and total duration (sum of per-event
// durations when present). The full item list is always returned for expansion.
function deriveTraceProps(events) {
  const list = Array.isArray(events) ? events : [];
  const items = list.map(mapEventToTrace);
  const steps = items.length;
  const filesChanged = items.filter((item) => item.kind === TRACE_KINDS.FILE).length;
  const durationMs = items.reduce(
    (sum, item) => sum + (Number(item.durationMs) || 0),
    0,
  );
  return { steps, filesChanged, durationMs, items };
}

// Human duration: seconds under a minute, else m + s.
function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

// "3 steps · 2 files changed · 12s"
function formatTraceSummary(trace) {
  const parts = [];
  const steps = trace?.steps || 0;
  parts.push(`${steps} step${steps === 1 ? '' : 's'}`);
  const filesChanged = trace?.filesChanged || 0;
  if (filesChanged > 0) {
    parts.push(`${filesChanged} file${filesChanged === 1 ? '' : 's'} changed`);
  }
  const duration = formatDuration(trace?.durationMs);
  if (duration) parts.push(duration);
  return parts.join(' · ');
}

// Resolves the human connection label for a turn, matching conversation.js.
function providerLabel(snapshot, turn) {
  if (!turn) return 'Unknown provider';
  const connections = Array.isArray(snapshot?.connections) ? snapshot.connections : [];
  const connection = connections.find(
    (item) => item.executorType === turn.provider
      && (!turn.model || item.modelId === turn.model),
  );
  return connection?.label || turn.provider || 'Unknown provider';
}

// Groups a flat turns array into runs (a user goal + the following agent answer).
// A trailing user turn with no answer yet becomes a run with answer: null; leading
// agent turns with no preceding goal become a run with goal: null.
function groupRuns(turns) {
  const list = Array.isArray(turns) ? turns : [];
  if (list.length === 0) return [];
  const runs = [];
  let current = null;
  const openRun = (seed) => {
    current = { goalTurn: null, answerTurn: null, agentId: null, connectionId: null, events: [], ...seed };
    runs.push(current);
    return current;
  };
  for (const turn of list) {
    if (turn.role === RUN_CARD_ROLES.USER) {
      if (current) openRun({});
      else openRun({});
      current.goalTurn = turn;
      current.agentId = turn.agentId || current.agentId;
    } else {
      if (!current) openRun({});
      current.answerTurn = turn;
      current.agentId = turn.agentId || current.agentId;
      current.connectionId = turn.connectionId || null;
    }
  }
  if (runs.length === 0) openRun({});
  return runs;
}

// Distributes flat activity events across runs. File events attach to the run whose
// answer turn's changedFiles include the event path; every other event (commands,
// tools, network, usage, permission) attaches to the most recent run. This is the
// documented, best-effort grouping given the schema carries no turn<->event linkage.
function distributeEvents(runs, events) {
  const list = Array.isArray(events) ? events : [];
  for (const event of list) {
    const owner = runs.find(
      (run) => Array.isArray(run.answerTurn?.changedFiles)
        && run.answerTurn.changedFiles.includes(event.path),
    );
    (owner || runs[runs.length - 1]).events.push(event);
  }
}

// Maps one grouped run to a run-card view model.
function mapTurnToRunCard(run, context = {}, index = 0) {
  const snapshot = context.snapshot || {};
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const answerAgent = run.answerTurn
    ? agents.find((item) => item.id === run.answerTurn.agentId)
    : (run.goalTurn ? agents.find((item) => item.id === run.goalTurn.agentId) : null);

  const goal = run.goalTurn
    ? {
      id: run.goalTurn.id || null,
      text: run.goalTurn.text || '',
      createdAt: run.goalTurn.createdAt || null,
      role: RUN_CARD_ROLES.USER,
    }
    : null;

  const answer = run.answerTurn
    ? {
      id: run.answerTurn.id || null,
      text: run.answerTurn.text || '',
      createdAt: run.answerTurn.createdAt || null,
      role: RUN_CARD_ROLES.AGENT,
      agentName: answerAgent?.name || 'Unknown agent',
      providerLabel: providerLabel(snapshot, run.answerTurn),
      model: run.answerTurn.model || null,
    }
    : null;

  const trace = deriveTraceProps(run.events);

  return {
    id: run.goalTurn?.id || run.answerTurn?.id || `run-${index}`,
    goal,
    answer,
    trace,
    createdAt: run.answerTurn?.createdAt || run.goalTurn?.createdAt || null,
    hasGoal: Boolean(run.goalTurn),
    hasAnswer: Boolean(run.answerTurn),
  };
}

// Top-level orchestrator: snapshot -> ordered run-card view models.
function buildRunCards(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const runs = groupRuns(snapshot.turns);
  distributeEvents(runs, snapshot.activity?.events);
  return runs.map((run, index) => mapTurnToRunCard(run, { snapshot }, index));
}

// Phase 3 Task 6: a run card can be "reopened for edits" when it carries a past
// goal with text. Reopening seeds the composer with that text so the user can edit
// and re-run it against the currently selected participant. A card without a goal
// (e.g. an agent turn with no preceding user goal) is not reopenable.
function canReopenForEdits(card) {
  if (!card || typeof card !== 'object') return false;
  const goal = card.goal;
  return Boolean(goal && typeof goal.text === 'string' && goal.text.trim().length > 0);
}

const runCardModel = Object.freeze({
  RUN_CARD_ROLES,
  TRACE_KINDS,
  FILE_OPERATION_LABELS,
  mapEventToTrace,
  parseDiffLine,
  deriveTraceProps,
  formatDuration,
  formatTraceSummary,
  providerLabel,
  groupRuns,
  distributeEvents,
  mapTurnToRunCard,
  buildRunCards,
  canReopenForEdits,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = runCardModel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.claudePetRunCardModel = runCardModel;
}
