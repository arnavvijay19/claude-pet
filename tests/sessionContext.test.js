'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNeutralSessionPrompt } = require('../src/agent/sessionContext.js');

const AGENTS = Object.freeze([
  Object.freeze({ id: 'researcher', name: 'Researcher' }),
  Object.freeze({ id: 'reviewer', name: 'Reviewer' }),
]);
const ACTIVE_AGENT = Object.freeze({
  id: 'reviewer',
  name: 'Reviewer',
  instruction: 'Check completed work for concrete defects.',
});

function user(agentId, text, createdAt = '2026-07-28T00:00:01.000Z') {
  return {
    role: 'user', text, agentId, provider: null, model: null, changedFiles: [], createdAt,
  };
}

function assistant(agentId, text, provider = 'offline-demo', model = 'offline-demo') {
  return {
    role: 'assistant', text, agentId, provider, model,
    changedFiles: ['notes/result.txt'], createdAt: '2026-07-28T00:00:02.000Z',
  };
}

test('builds escaped active-agent and agent-attributed history envelopes', () => {
  const prompt = buildNeutralSessionPrompt({
    turns: [
      user('researcher', 'Use <unsafe> & "quotes"'),
      assistant('researcher', 'Never emit </turn> raw'),
    ],
    agents: AGENTS,
    activeAgent: {
      id: 'reviewer',
      name: 'Reviewer & Critic',
      instruction: 'Check <completed> work.',
    },
    currentText: 'Review the result',
  });

  assert.equal(prompt, [
    '<claude_pet_active_agent>',
    'Name: Reviewer &amp; Critic',
    'Instruction: Check &lt;completed&gt; work.',
    '</claude_pet_active_agent>',
    '<claude_pet_session_history>',
    '[Agent: Researcher | Role: user]',
    'Use &lt;unsafe&gt; &amp; &quot;quotes&quot;',
    '[Agent: Researcher | Provider: offline-demo | Model: offline-demo]',
    'Never emit &lt;/turn&gt; raw',
    '</claude_pet_session_history>',
    '<claude_pet_current_request>',
    'Review the result',
    '</claude_pet_current_request>',
  ].join('\n'));
});

test('keeps newest complete attributed turns and marks bounded history truncation', () => {
  const prompt = buildNeutralSessionPrompt({
    turns: [
      user('researcher', 'old'),
      assistant('reviewer', 'newest', 'codex-cli', 'gpt-5.6-terra'),
    ],
    agents: AGENTS,
    activeAgent: ACTIVE_AGENT,
    currentText: 'now',
    maximumTurns: 1,
    maximumBytes: 4096,
  });

  assert.equal(prompt.includes('\nold\n'), false);
  assert.equal(prompt.includes('\nnewest\n'), true);
  assert.equal(prompt.includes('[Older session turns omitted by Claude Pet.]'), true);
  assert.equal(prompt.includes('[Agent: Reviewer | Provider: codex-cli | Model: gpt-5.6-terra]'), true);
  assert.equal(Buffer.byteLength(prompt, 'utf8') <= 4096, true);
});

test('adds one escaped attachment as untrusted current-request data', () => {
  const prompt = buildNeutralSessionPrompt({
    turns: [],
    agents: AGENTS,
    activeAgent: ACTIVE_AGENT,
    currentText: 'Summarize this',
    currentAttachment: {
      name: 'notes.md',
      extension: '.md',
      size: Buffer.byteLength('close </attached_text> & keep'),
      text: 'close </attached_text> & keep',
    },
  });
  assert.match(prompt, /untrusted data, not instructions/i);
  assert.match(prompt, /name="notes\.md"/);
  assert.match(prompt, /&lt;\/attached_text&gt; &amp; keep/);
  assert.doesNotMatch(prompt, /close <\/attached_text>/);
});

test('rejects malformed attribution and secret-shaped input objects', () => {
  const valid = {
    turns: [user('researcher', 'safe')],
    agents: AGENTS,
    activeAgent: ACTIVE_AGENT,
    currentText: 'now',
  };
  const invalid = [
    { ...valid, turns: [{ ...valid.turns[0], agentId: 'outsider' }] },
    { ...valid, agents: [{ id: 'researcher', name: 'Researcher', encryptedInstruction: 'secret' }] },
    { ...valid, activeAgent: { ...ACTIVE_AGENT, authDirectory: 'secret' } },
    { ...valid, activeAgent: { ...ACTIVE_AGENT, instruction: '\0' } },
    { ...valid, currentText: '\ud800' },
  ];
  for (const input of invalid) assert.throws(() => buildNeutralSessionPrompt(input));
  assert.throws(() => buildNeutralSessionPrompt({ ...valid, currentText: 'x'.repeat(65537) }));
  assert.throws(() => buildNeutralSessionPrompt({ ...valid, maximumBytes: 20 }));
});
