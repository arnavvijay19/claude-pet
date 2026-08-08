'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { buildRendererVendor, VENDOR_SOURCES } = require('../scripts/build-renderer-vendor.js');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function makeFakeNodeModules(rootDir, sources) {
  const nodeModules = path.join(rootDir, 'node_modules');
  for (const [pkg, file, content] of sources) {
    const pkgDir = path.join(nodeModules, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'),
      `${JSON.stringify({ name: pkg, version: '0.0.0' })}\n`, 'utf8');
    const dir = path.join(pkgDir, path.dirname(file));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, path.basename(file)), content, 'utf8');
  }
  return nodeModules;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-vendor-'));
}

// Best-effort removal: the sandbox safe-delete shim may refuse bulk deletes, so
// never let cleanup turn a passing test into a failure.
function safeRemove(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* cleanup is best-effort only */
  }
}

test('vendors preact and htm runtime ESM and records SHA-256 integrity', () => {
  const root = tempDir();
  try {
    const preactSource = 'export const h = "preact-stub";\n';
    const htmSource = 'export default function htm() {}\n';
    const nodeModules = makeFakeNodeModules(root, [
      ['preact', 'dist/preact.mjs', preactSource],
      ['htm', 'dist/htm.mjs', htmSource],
    ]);
    const outputDir = path.join(root, 'src', 'renderer', 'vendor');
    const record = buildRendererVendor({ rootDir: root, nodeModulesPath: nodeModules, outputDir });

    assert.equal(record.schemaVersion, 1);
    assert.equal(record.files['preact.mjs'], sha256(preactSource));
    assert.equal(record.files['htm.mjs'], sha256(htmSource));

    const writtenPreact = fs.readFileSync(path.join(outputDir, 'preact.mjs'), 'utf8');
    const writtenHtm = fs.readFileSync(path.join(outputDir, 'htm.mjs'), 'utf8');
    assert.equal(writtenPreact, preactSource);
    assert.equal(writtenHtm, htmSource);

    const integrity = JSON.parse(fs.readFileSync(path.join(outputDir, 'integrity.json'), 'utf8'));
    // record.files is a null-prototype map; JSON.parse yields a regular object,
    // so compare plain copies (the SHA-256 values are what matters).
    assert.deepEqual({ ...integrity.files }, { ...record.files });
  } finally {
    safeRemove(root);
  }
});

test('strips trailing sourceMappingURL comments so the vendor is map-free', () => {
  const root = tempDir();
  try {
    const preactSource = 'export const h = "preact-stub";\n//# sourceMappingURL=preact.mjs.map\n';
    const nodeModules = makeFakeNodeModules(root, [
      ['preact', 'dist/preact.mjs', preactSource],
      ['htm', 'dist/htm.mjs', 'export default function htm() {}\n'],
    ]);
    const outputDir = path.join(root, 'src', 'renderer', 'vendor');
    buildRendererVendor({ rootDir: root, nodeModulesPath: nodeModules, outputDir });

    const written = fs.readFileSync(path.join(outputDir, 'preact.mjs'), 'utf8');
    assert.equal(written.includes('sourceMappingURL'), false, 'map comment must be stripped');
    assert.equal(written, 'export const h = "preact-stub";\n');
    assert.equal(fs.existsSync(path.join(outputDir, 'preact.mjs.map')), false);
  } finally {
    safeRemove(root);
  }
});

test('refuses to emit a source map file', () => {
  const root = tempDir();
  try {
    const mapSource = '{}';
    const nodeModules = makeFakeNodeModules(root, [
      ['preact', 'dist/preact.mjs', 'export const h = 1;\n'],
      ['htm', 'dist/htm.mjs', 'export default function htm() {}\n'],
    ]);
    // Inject a rogue .map source and force it through the VENDOR_SOURCES list.
    const outputDir = path.join(root, 'src', 'renderer', 'vendor');
    assert.throws(
      () => buildRendererVendor({
        rootDir: root,
        nodeModulesPath: nodeModules,
        outputDir,
        sources: [{ name: 'evil.mjs.map', pkg: 'preact', dist: 'dist/preact.mjs' }],
      }),
      /must not emit source maps/i,
    );
  } finally {
    safeRemove(root);
  }
});

test('fails closed when a renderer dependency is missing', () => {
  const root = tempDir();
  try {
    const nodeModules = makeFakeNodeModules(root, [
      ['htm', 'dist/htm.mjs', 'export default function htm() {}\n'],
    ]);
    const outputDir = path.join(root, 'src', 'renderer', 'vendor');
    assert.throws(
      () => buildRendererVendor({ rootDir: root, nodeModulesPath: nodeModules, outputDir }),
      /unavailable: preact/i,
    );
  } finally {
    safeRemove(root);
  }
});

test('exports a frozen, non-empty source manifest', () => {
  assert.ok(Array.isArray(VENDOR_SOURCES));
  assert.equal(VENDOR_SOURCES.length, 2);
  for (const source of VENDOR_SOURCES) {
    assert.ok(source.name.endsWith('.mjs'));
    assert.ok(!source.dist.includes('.map'));
  }
});
