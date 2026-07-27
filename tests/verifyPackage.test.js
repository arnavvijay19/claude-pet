'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { verifyPackage } = require('../scripts/verify_package.js');
test('rejects runtime state, development trees, source maps, and secret-shaped text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-package-'));
  try { fs.writeFileSync(path.join(root, 'app.js.map'), 'x'); assert.throws(() => verifyPackage(root), /source-map-suffix/); fs.rmSync(path.join(root, 'app.js.map'));
    fs.writeFileSync(path.join(root, 'connections.json'), '{}'); assert.throws(() => verifyPackage(root), /runtime-state/); fs.rmSync(path.join(root, 'connections.json'));
    fs.writeFileSync(path.join(root, 'readme.txt'), 'Bearer abcdefghijklmnopqrstuvwxyz'); assert.throws(() => verifyPackage(root), /secret-pattern/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
