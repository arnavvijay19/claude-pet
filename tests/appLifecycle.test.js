'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAppWindowController,
  createVisibleRequestTracker,
} = require('../src/appWindow.js');

function fakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

function appDependencies() {
  return {
    coordinator: {
      snapshot: async () => ({
        agents: [], sessions: [], selection: { sessionId: null, agentId: null },
        activeAgent: null, session: null, turns: [],
      }),
      busy: () => false,
    },
    connections: { listConnections: async () => [] },
    manager: { getSnapshot: () => ({ busy: false }) },
    activity: {
      snapshot: () => ({ run: null, events: [] }),
      subscribe: () => () => {},
    },
  };
}

test('pet, tray, and first launch share one app window whose close hides to tray', () => {
  const windows = [];
  function BrowserWindow(options) {
    const listeners = {};
    const window = {
      options,
      hidden: 0,
      destroyed: false,
      webContents: { send() {} },
      loadFile() {},
      show() {},
      focus() {},
      hide() { this.hidden += 1; },
      isDestroyed() { return this.destroyed; },
      on(name, listener) { listeners[name] = listener; },
      emit(name, event) { listeners[name]?.(event); },
    };
    windows.push(window);
    return window;
  }
  const controller = createAppWindowController({
    BrowserWindow,
    ipcMain: fakeIpc(),
    ...appDependencies(),
  });
  const firstLaunch = controller.show();
  const tray = controller.show({ view: 'conversation' });
  const pet = controller.show({ view: 'conversation' });
  let prevented = false;
  firstLaunch.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(firstLaunch, tray);
  assert.equal(tray, pet);
  assert.equal(windows.length, 1);
  assert.equal(prevented, true);
  assert.equal(firstLaunch.hidden, 1);
});

test('shared app window closes normally when the application is quitting', () => {
  function BrowserWindow() {
    const listeners = {};
    return {
      hidden: 0,
      destroyed: false,
      webContents: { send() {} },
      loadFile() {},
      show() {},
      focus() {},
      hide() { this.hidden += 1; },
      isDestroyed() { return this.destroyed; },
      on(name, listener) { listeners[name] = listener; },
      emit(name, event) { listeners[name]?.(event); },
    };
  }
  const controller = createAppWindowController({
    BrowserWindow,
    ipcMain: fakeIpc(),
    shouldHideOnClose: () => false,
    ...appDependencies(),
  });
  const window = controller.show();
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(window.hidden, 0);
});

test('retry stores only the visible request and uses the currently selected participant', async () => {
  const calls = [];
  const tracker = createVisibleRequestTracker({
    submit: async (text) => calls.push(text),
  });
  await tracker.submit('Review the visible request');
  tracker.noteAttachment();
  await tracker.retry();
  assert.deepEqual(calls, ['Review the visible request', 'Review the visible request']);
  assert.equal(tracker.visibleRequest(), 'Review the visible request');
});

test('an invalid goal cannot replace the last valid retry request', async () => {
  const calls = [];
  const tracker = createVisibleRequestTracker({
    submit: async (text) => calls.push(text),
  });
  await tracker.submit('Keep this request');
  await assert.rejects(
    tracker.submit('é'.repeat(4097)),
    (error) => error?.code === 'UNSUPPORTED_OPTION',
  );
  await tracker.retry();
  assert.deepEqual(calls, ['Keep this request', 'Keep this request']);
  assert.equal(tracker.visibleRequest(), 'Keep this request');
});

test('production lifecycle has one app subscription and no legacy window or polling path', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
  const pet = fs.readFileSync(path.join(root, 'src', 'renderer', 'renderer-main.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'app', 'app.js'), 'utf8');
  assert.match(preload, /openApp/);
  assert.match(pet, /openApp/);
  assert.match(main, /appWindowController\.show\(\{ view: 'conversation' \}\)/);
  assert.match(main, /app\.on\('before-quit', \(\) => \{ isQuitting = true; \}\)/);
  assert.match(main, /shouldHideOnClose: \(\) => !isQuitting/);
  assert.match(main, /promptTokenFromEnvironment/);
  assert.match(main, /promptPort !== null && promptToken/);
  assert.doesNotMatch(main, /SettingsWindow|ResponseWindow|'(?:response|settings):/);
  assert.equal((app.match(/bridge\.subscribe\(/g) || []).length, 1);
  assert.doesNotMatch(app, /setInterval|1000/);
});

test('shared-session reload, disclosures, warnings, and busy guards remain main-owned', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const boundary = fs.readFileSync(path.join(root, 'src', 'appWindow.js'), 'utf8');
  const snapshot = fs.readFileSync(path.join(root, 'src', 'app', 'appSnapshot.js'), 'utf8');
  assert.match(main, /confirmProviderSwitch/);
  assert.match(main, /authorizeTextAttachment/);
  assert.match(main, /createFullComputerAuthorization/);
  assert.match(boundary, /AGENT_BUSY/);
  assert.match(snapshot, /coordinator\.turns\.map\(turn\)/);
  assert.match(snapshot, /coordinator\.selection/);
});

test('a fresh-profile launch binds runtime persistence to the requested user-data directory', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /--user-data-dir=/);
  assert.match(main, /app\.setPath\('userData'/);
});
