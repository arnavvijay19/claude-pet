'use strict';

// Phase 3 Task 6 integration: reopening a past goal in the composer for re-run.
// Fakes the run-card controller (exposed on globalThis) so we can capture the
// onReopenGoal the conversation wires up, then assert it seeds the composer and
// re-renders. The actual re-run flows through the existing submit/retry path and
// the stale-selection guards (covered elsewhere), so this test owns only the
// composer-seeding half.

const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert/strict');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;

// Capture the onReopenGoal the conversation passes into createRunCardHost.
let capturedReopen = null;
global.claudePetRunCards = {
  createRunCardHost(_host, options) {
    capturedReopen = options && options.onReopenGoal;
    return { update() {} };
  },
};

const { renderConversation } = require('../src/app/conversation.js');

function makeDraftState() {
  const store = {};
  return {
    composerCalls: [],
    setComposer(id, text) { this.composerCalls.push([id, text]); store[id] = text; },
    clearComposer(id) { delete store[id]; },
    composer(id) { return store[id] || ''; },
  };
}

const snapshot = {
  activeAgent: { id: 'reviewer', name: 'Reviewer' },
  agents: [{ id: 'reviewer', name: 'Reviewer' }],
  session: { id: 'shared', title: 'Work', workspacePath: 'Z:\\w', participants: [] },
  sessions: [],
  selection: { sessionId: 'shared', agentId: 'reviewer' },
  connections: [],
  turns: [
    { id: 't1', role: 'user', agentId: 'reviewer', text: 'Investigate the crash', createdAt: 'now' },
    { id: 't2', role: 'assistant', agentId: 'reviewer', text: 'Found it.', changedFiles: [], createdAt: 'now' },
  ],
  activity: { events: [] },
  run: { busy: false },
};

test('reopening a past goal seeds the composer with its text and re-renders (Phase 3 Task 6)', () => {
  const draftState = makeDraftState();
  const dispatched = [];
  const dispatch = (type, payload) => { dispatched.push([type, payload]); };

  const target = document.createElement('div');
  renderConversation(target, snapshot, dispatch, { document: global.document, draftState });

  assert.ok(capturedReopen, 'conversation wired an onReopenGoal into the run-card controller');
  assert.equal(draftState.composerCalls.length, 0, 'composer not seeded before reopen');

  // Simulate the run card's "Re-run with edits" button.
  capturedReopen('Investigate the crash');

  assert.deepEqual(
    draftState.composerCalls,
    [['shared', 'Investigate the crash']],
    'composer seeded with the past goal text for the current session',
  );
  assert.deepEqual(
    dispatched,
    [['set-view', { view: 'conversation' }]],
    're-render dispatched so the seeded composer shows',
  );
});
