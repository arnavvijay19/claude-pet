'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { claimSingleInstance } = require('../src/singleInstance.js');

function createApp(lockGranted) {
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => lockGranted;
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls += 1; };
  return app;
}

test('a second launch exits without starting another Claude Pet instance', () => {
  const app = createApp(false);

  assert.equal(claimSingleInstance(app, () => {}), false);
  assert.equal(app.quitCalls, 1);
  assert.equal(app.listenerCount('second-instance'), 0);
});

test('the primary instance handles a later launch by revealing its app window', () => {
  const app = createApp(true);
  let revealCalls = 0;

  assert.equal(claimSingleInstance(app, () => { revealCalls += 1; }), true);
  app.emit('second-instance');

  assert.equal(app.quitCalls, 0);
  assert.equal(revealCalls, 1);
});
