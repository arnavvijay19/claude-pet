'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('does not expose a file-submission bridge before Task 14', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.doesNotMatch(source, /pet:file-dropped|sendDroppedFile|webUtils\.getPathForFile/);
});

test('exposes only narrow session switch IPC from Settings and never a raw session payload', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings-preload.js'), 'utf8');
  assert.match(source, /sessionSnapshot/);
  assert.match(source, /createAgent/);
  assert.doesNotMatch(source, /encryptedTurns|decrypt|resumeId|auth/);
});
