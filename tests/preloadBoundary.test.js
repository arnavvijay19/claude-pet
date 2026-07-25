'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('does not expose a file-submission bridge before Task 14', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.doesNotMatch(source, /pet:file-dropped|sendDroppedFile|webUtils\.getPathForFile/);
});
