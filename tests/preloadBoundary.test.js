'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('exposes one exact main-window snapshot subscription and intent bridge', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-preload.js'), 'utf8');
  assert.match(source, /exposeInMainWorld\('claudePetApp'/);
  assert.match(source, /snapshot/);
  assert.match(source, /subscribe/);
  assert.match(source, /intent/);
  assert.match(source, /app:snapshot/);
  assert.match(source, /app:intent/);
  assert.doesNotMatch(source, /response:|settings:|readFile|encrypted|dismissCapability/);
});
test('exposes only the narrow pet state, drag, and dropped File bridge', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(source, /onState/);
  assert.match(source, /webUtils\.getPathForFile/);
  assert.match(source, /submitTextFile/);
  assert.doesNotMatch(source, /readFile|filePath:\s*|onPrompt|onResponse/);
});
