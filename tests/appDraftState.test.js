'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDraftState } = require('../src/app/draftState.js');

test('keeps bounded composer drafts per session and clears them explicitly', () => {
  const drafts = createDraftState();
  drafts.setComposer('session-a', 'unsent A');
  drafts.setComposer('session-b', 'unsent B');
  assert.equal(drafts.composer('session-a'), 'unsent A');
  assert.equal(drafts.composer('session-b'), 'unsent B');
  drafts.clearComposer('session-a');
  assert.equal(drafts.composer('session-a'), '');
  assert.equal(drafts.composer('session-b'), 'unsent B');
  assert.throws(() => drafts.setComposer('session-a', 'é'.repeat(4097)));
});

test('retains only the newest 32 session drafts and patches settings by key', () => {
  const drafts = createDraftState();
  for (let index = 0; index < 33; index += 1) {
    drafts.setComposer(`session-${index}`, `draft-${index}`);
  }
  assert.equal(drafts.composer('session-0'), '');
  assert.equal(drafts.composer('session-32'), 'draft-32');
  drafts.patchSettings('agent:a', { name: 'Researcher' });
  drafts.patchSettings('agent:a', { instruction: 'Inspect evidence.' });
  assert.deepEqual(drafts.settings('agent:a'), {
    name: 'Researcher',
    instruction: 'Inspect evidence.',
  });
});
