'use strict';

// Phase 3 Task 8 (design 3.8): export a session to a local Markdown run log.
//
// Pure, framework-free: builds the Markdown body (goals, steps, diffs, answers)
// plus a sanitized filename and the session workspace, so the caller can save to a
// user-chosen path. There is NO cloud / network / telemetry here. No DOM, no
// Electron, no Preact — which keeps it fully unit-testable in Node.
//
// Dual-mode: loaded as a classic <script> (exposes globalThis.claudePetExportSession)
// and require()able in Node for tests.

function sanitizeFilename(input, fallback) {
  const fallbackName = typeof fallback === 'string' && fallback ? fallback : 'session';
  if (typeof input !== 'string' || !input.trim()) return fallbackName;
  // Drop path separators and reserved characters; collapse whitespace; cap length.
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || fallbackName;
}

function sessionTitle(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'Session';
  if (typeof snapshot.session?.title === 'string' && snapshot.session.title) return snapshot.session.title;
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const activeId = typeof snapshot.selection?.sessionId === 'string' ? snapshot.selection.sessionId : null;
  if (activeId) {
    const found = sessions.find((s) => s.id === activeId);
    if (found?.title) return found.title;
  }
  return 'Session';
}

function sessionWorkspace(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const direct = snapshot.session?.workspacePath;
  if (typeof direct === 'string' && direct) return direct;
  const activeId = typeof snapshot.selection?.sessionId === 'string' ? snapshot.selection.sessionId : null;
  if (activeId) {
    const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    const found = sessions.find((s) => s.id === activeId);
    if (typeof found?.workspacePath === 'string' && found.workspacePath) return found.workspacePath;
  }
  return null;
}

// Human-readable subtitle for a single activity event (mirrors responseViewModel
// detailFor but returns a plain string for the export log).
function stepLabel(event) {
  if (!event || typeof event !== 'object') return null;
  switch (event.kind) {
    case 'file': return `${event.operation || 'change'} ${event.path || 'unknown'}`;
    case 'command': return `${event.command || ''} (exit ${typeof event.exitCode === 'number' ? event.exitCode : '?'})`;
    case 'network': return event.destination || '';
    case 'permission': return `${event.decision || ''} ${event.permission || ''}`.trim();
    case 'usage': {
      const u = event.usage || {};
      return `input ${u.inputTokens ?? '?'} · output ${u.outputTokens ?? '?'} · cached ${u.cachedTokens ?? '?'} · total ${u.totalTokens ?? '?'}`;
    }
    case 'tool': return event.toolName || '';
    case 'status':
    case 'message':
      return '';
    default:
      return typeof event.summary === 'string' ? event.summary : '';
  }
}

function buildSteps(events) {
  const list = Array.isArray(events) ? events : [];
  const lines = [];
  list.forEach((event, index) => {
    const primary = stepLabel(event);
    const detail = typeof event.detail === 'string' && event.detail ? event.detail : '';
    const text = [primary, detail].filter(Boolean).join(' — ');
    const summary = typeof event.summary === 'string' && event.summary ? event.summary : '';
    const body = text || summary;
    if (body) lines.push(`- ${index + 1}. [${event.kind || 'event'}] ${body}`);
  });
  return lines;
}

function buildExportSession(snapshot, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!snapshot || typeof snapshot !== 'object') {
    return { title: 'Session', filename: 'session.md', workspacePath: null, markdown: '' };
  }
  const title = sessionTitle(snapshot);
  const workspacePath = sessionWorkspace(snapshot);
  const filename = `${sanitizeFilename(title, 'session')}.md`;

  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  const events = Array.isArray(snapshot.activity?.events) ? snapshot.activity.events : [];

  const goals = turns.filter((t) => t?.role === 'user' && typeof t.text === 'string' && t.text.trim());
  const answers = turns.filter((t) => t?.role === 'assistant' && typeof t.text === 'string' && t.text.trim());
  const steps = buildSteps(events);
  const diffs = events.filter((e) => e?.kind === 'file' && typeof e.diff === 'string' && e.diff);

  const nowIso = typeof opts.now === 'string'
    ? opts.now
    : (opts.now instanceof Date ? opts.now.toISOString() : new Date().toISOString());

  const lines = [];
  lines.push(`# ${title}`, '');
  lines.push(`_Exported ${nowIso}_`, '');

  lines.push('## Goals', '');
  if (goals.length === 0) lines.push('_No goals recorded._', '');
  else goals.forEach((goal) => lines.push(`- ${goal.text}`, ''));

  lines.push('## Steps', '');
  if (steps.length === 0) lines.push('_No activity recorded._', '');
  else steps.forEach((step) => lines.push(step, ''));

  if (diffs.length > 0) {
    lines.push('## Diffs', '');
    diffs.forEach((event) => {
      lines.push(`### ${event.path || 'file'} (${event.operation || 'change'})`, '');
      lines.push('```diff', event.diff, '```', '');
    });
  }

  if (answers.length > 0) {
    lines.push('## Answers', '');
    answers.forEach((answer, index) => {
      lines.push(`### Answer ${index + 1}`, '', answer.text, '');
    });
  }

  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { title, filename, workspacePath, markdown };
}

const exportSession = Object.freeze({
  buildExportSession,
  sanitizeFilename,
  sessionTitle,
  sessionWorkspace,
});

if (typeof module !== 'undefined' && module.exports) module.exports = exportSession;
if (typeof globalThis !== 'undefined') globalThis.claudePetExportSession = exportSession;
