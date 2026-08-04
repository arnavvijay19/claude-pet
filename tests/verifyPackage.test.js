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

test('rejects development metadata that must not ship in a Windows package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-package-development-metadata-'));
  try {
    for (const relativePath of [
      '.superpowers/sdd/task-7-report.md',
      '.github/workflows/ci.yml',
      '.gitattributes',
      '.gitignore',
    ]) {
      const full = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'development-only');
      assert.throws(() => verifyPackage(root), /development-tree/, relativePath);
      fs.rmSync(full, { force: true });
      for (let directory = path.dirname(full); directory !== root; directory = path.dirname(directory)) {
        fs.rmdirSync(directory);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('allows only the explicit account-free probe bearer sentinel', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-package-fixture-'));
  try { fs.writeFileSync(path.join(root, 'fixture.json'), 'Bearer __OWNER_BEARER__'); assert.deepEqual(verifyPackage(root), { files: 1, bytes: 23 }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scans secret-shaped text beyond the first MiB', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-package-large-'));
  try {
    fs.writeFileSync(
      path.join(root, 'large.js'),
      `${'x'.repeat(1024 * 1024 + 64)}\nBearer abcdefghijklmnopqrstuvwxyz`,
    );
    assert.throws(() => verifyPackage(root), /secret-pattern/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects legacy Settings and Response renderers and channels', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-package-legacy-'));
  try {
    fs.writeFileSync(path.join(root, 'response-preload.js'), 'response:state');
    assert.throws(() => verifyPackage(root), /legacy-renderer/);
    fs.rmSync(path.join(root, 'response-preload.js'));
    fs.writeFileSync(path.join(root, 'main.js'), "ipcMain.handle('settings:snapshot')");
    assert.throws(() => verifyPackage(root), /legacy-channel/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
