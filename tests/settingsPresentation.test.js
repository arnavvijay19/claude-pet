'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectionSummary,
  draftForSelection,
} = require('../src/settings/settingsPresentation.js');

test('real-provider renderer drafts default to Full Computer without authorization fields', () => {
  const draft = draftForSelection({
    executorType: 'codex-cli', workspacePath: ' Z:\\work ',
    modelId: 'gpt-5.6-terra', effort: 'medium',
  });
  assert.deepEqual(draft, {
    executorType: 'codex-cli', label: 'Codex', workspacePath: 'Z:\\work',
    permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra',
    effort: 'medium', keyHint: null,
  });
  for (const forbidden of ['fullAccessConfirmed', 'revision', 'nonce', 'confirmation', 'reservedId']) {
    assert.equal(Object.hasOwn(draft, forbidden), false);
  }
});

test('Offline Demo stays Workspace-only and connection summaries retain the permanent badge', () => {
  assert.deepEqual(draftForSelection({
    executorType: 'offline-demo', workspacePath: 'Z:\\work',
  }), {
    executorType: 'offline-demo', label: 'Offline Demo', workspacePath: 'Z:\\work',
    permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null,
  });
  assert.equal(connectionSummary({
    label: 'Codex', workspacePath: 'Z:\\work',
    permissionBadge: 'FULL COMPUTER - broad PC access',
  }), 'Codex - Z:\\work - FULL COMPUTER - broad PC access');
});
