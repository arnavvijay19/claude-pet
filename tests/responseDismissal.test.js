'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResponseState } = require('../src/response/responseState.js');
const { createResponseViewModel } = require('../src/response/responseViewModel.js');

test('exposes a dismiss capability only after the current response succeeds', () => {
  const state = createResponseState();
  state.begin({ executor: 'offline-demo' }, { responseGeneration: 3, dismissCapability: 'opaque' });
  assert.equal(createResponseViewModel(state.snapshot()).canDismiss, false);
  state.success({ text: 'done', changedFiles: [] });
  const view = createResponseViewModel(state.snapshot());
  assert.equal(view.canDismiss, true);
  assert.deepEqual(view.dismiss, { responseGeneration: 3, dismissCapability: 'opaque' });
});
