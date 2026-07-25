'use strict';
const path = require('node:path');
const { createConnectionStore } = require('./agent/connectionStore.js');
const { createActivityStore } = require('./agent/activityStore.js');
const { createAgentManager } = require('./agent/agentManager.js');
const { createOfflineDemoExecutor } = require('./agent/executors/offlineDemoExecutor.js');

function createAbortableDelayGate({ delayMs = 3000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  return Object.freeze({
    wait(signal) {
      if (signal?.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (cancelTimer) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          if (cancelTimer && timer !== null) clearTimeoutFn(timer);
          resolve();
        };
        const onAbort = () => finish(true);
        timer = setTimeoutFn(() => finish(false), delayMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    },
  });
}

function createAgentRuntime({ userDataPath, crypto, randomId }) {
  const store = createConnectionStore({ filePath: path.join(userDataPath, 'connections.json'), crypto, randomId });
  const activity = createActivityStore();
  const manager = createAgentManager({ store, activity, executors: { 'offline-demo': createOfflineDemoExecutor({ gate: createAbortableDelayGate() }) } });
  return Object.freeze({ store, activity, manager, initialize: () => store.initialize() });
}
module.exports = { createAbortableDelayGate, createAgentRuntime };
