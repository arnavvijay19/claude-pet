'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildNativeCliInspector } = require('../scripts/build-native-cli-inspector.js');

test('build emits a deterministic inspector and records both hashes', () => {
  const record = buildNativeCliInspector();
  assert.equal(record.protocolVersion, 1);
  assert.equal(record.architecture, 'x64');
  assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(record.executableSha256, /^[a-f0-9]{64}$/);
  const generated = path.join(__dirname, '..', 'resources', 'windows', 'generated', 'native-cli-inspector.exe');
  assert.equal(fs.existsSync(generated), true);
});
