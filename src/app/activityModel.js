'use strict';

// Phase 3 Task 9 (design 3.9): Activity noise is reduced by default while an
// expandable, timestamped diagnostic view is retained.
//
// Pure, framework-free logic for the activity drawer:
//   - classifyActivityEvent: routine "noise" vs notable event
//   - formatActivityTimestamp: a short, human timestamp for the diagnostic view
//   - activityEventSummary: concise { label, timestamp, level } for one event
//
// No DOM, no Electron, no Preact: fully unit-testable in Node. Dual-mode: loaded
// as a classic <script> (exposes globalThis.claudePetActivityModel) and require()-able.

// Concise, safe label for an activity event (mirrors conversation.js activityLabel).
function activityEventLabel(event) {
  if (!event || typeof event !== 'object') return 'Agent activity';
  const labels = {
    file: () => `${event.operation === 'write' ? 'Updated' : 'Read'} ${event.path}`,
    command: () => (event.exitCode === 0 ? 'Command completed' : 'Command failed'),
    tool: () => `Used ${event.toolName}`,
    permission: () => `${event.decision === 'allow' ? 'Allowed' : 'Denied'} ${event.permission}`,
    network: () => 'Used network access',
    usage: () => 'Updated token usage',
    message: () => event.summary || 'Agent response',
  };
  const format = labels[event.kind];
  return format ? format() : 'Agent activity';
}

// Routine, low-signal activity is "noise": file reads, token-usage updates, and
// generic network calls. Everything that changed state or is diagnostically useful
// (writes, commands, tool use, permissions, agent responses) is a notable event.
function classifyActivityEvent(event) {
  if (!event || typeof event !== 'object') return 'event';
  switch (event.kind) {
    case 'file': return event.operation === 'read' ? 'noise' : 'event';
    case 'usage': return 'noise';
    case 'network': return 'noise';
    case 'command': return 'event';
    case 'tool': return 'event';
    case 'permission': return 'event';
    case 'message': return 'event';
    default: return 'event';
  }
}

// Short HH:MM:SS timestamp. Tolerates epoch-ms numbers and ISO strings; returns ''
// when there is nothing to show so callers can omit the timestamp cleanly.
// Formatted in UTC so the diagnostic view is deterministic regardless of the
// machine timezone (and matches the recorded event time directly).
function formatActivityTimestamp(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = (typeof value === 'number') ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

// Concise summary for one event: the safe label, a formatted timestamp (when
// present), and the noise/event level. The full diagnostic JSON is rendered by the
// drawer's expandable detail; this is only the collapsed, reduced-noise surface.
function activityEventSummary(event) {
  const label = activityEventLabel(event);
  const level = classifyActivityEvent(event);
  const timestamp = formatActivityTimestamp(event?.timestamp);
  return Object.freeze({ label, level, timestamp });
}

// Split a list of events into routine (noise) and notable (event) buckets. Used by
// the drawer to hide routine activity by default behind a single reveal toggle.
function splitActivityEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const routine = [];
  const notable = [];
  for (const event of list) {
    if (classifyActivityEvent(event) === 'noise') routine.push(event);
    else notable.push(event);
  }
  return Object.freeze({ routine: Object.freeze(routine), notable: Object.freeze(notable) });
}

const activityModel = Object.freeze({
  activityEventLabel,
  classifyActivityEvent,
  formatActivityTimestamp,
  activityEventSummary,
  splitActivityEvents,
});

if (typeof module !== 'undefined' && module.exports) module.exports = activityModel;
if (typeof globalThis !== 'undefined') globalThis.claudePetActivityModel = activityModel;
