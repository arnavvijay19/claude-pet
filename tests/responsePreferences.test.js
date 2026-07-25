'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createResponsePreferences } = require('../src/response/responsePreferences.js');

test('remembers only the supported response activity view', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-response-'));
  const preferences = createResponsePreferences({ filePath: path.join(directory, 'response-preferences.json') });
  try {
    assert.equal(preferences.read(), null);
    preferences.write('comprehensive');
    assert.equal(preferences.read(), 'comprehensive');
    preferences.write('not-a-view');
    assert.equal(preferences.read(), 'comprehensive');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
