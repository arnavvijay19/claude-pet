'use strict';

// Vendors the Preact + htm runtime ESM builds into src/renderer/vendor so the
// Phase 3 renderer can import them with relative paths instead of bare
// specifiers. Bare-specifier ESM resolution fails under file:// in an
// asar=false package, and vendoring keeps the package deterministic and
// offline-capable. Only runtime ESM is emitted (no .map), and the SHA-256 of
// every emitted file is recorded in integrity.json so a regenerated vendor
// directory can be diffed for tampering. This mirrors scripts/build-provider-job-host.js.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = 1;

// name = emitted filename, pkg = npm package, dist = file inside the package's dist/.
const VENDOR_SOURCES = Object.freeze([
  Object.freeze({ name: 'preact.mjs', pkg: 'preact', dist: 'dist/preact.mjs' }),
  Object.freeze({ name: 'htm.mjs', pkg: 'htm', dist: 'dist/htm.mjs' }),
]);

// Trailing sourceMappingURL comments point at a .map that we deliberately do not
// vendor. Strip them so the emitted runtime file is fully self-contained and
// map-free (the package scan forbids shipping source maps).
const SOURCE_MAP_COMMENT = /\n?\/\/#\s*sourceMappingURL=.*\s*$/u;

function sha256File(filePath, fileSystem) {
  const hash = crypto.createHash('sha256');
  const descriptor = fileSystem.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const bytesRead = fileSystem.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fileSystem.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function isRegularFile(filePath, fileSystem) {
  try {
    const stat = fileSystem.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function stripSourceMapComment(text) {
  return text.replace(SOURCE_MAP_COMMENT, '\n');
}

function buildRendererVendor(options = {}) {
  const {
    rootDir = ROOT,
    nodeModulesPath = path.join(ROOT, 'node_modules'),
    outputDir = path.join(ROOT, 'src', 'renderer', 'vendor'),
    fileSystem = fs,
    pathModule = path,
    sources = VENDOR_SOURCES,
  } = options;

  if (typeof rootDir !== 'string' || !pathModule.isAbsolute(rootDir)) {
    throw new TypeError('Renderer vendor root must be an absolute path');
  }
  if (typeof nodeModulesPath !== 'string' || !pathModule.isAbsolute(nodeModulesPath)) {
    throw new TypeError('Renderer vendor node_modules path must be an absolute path');
  }
  if (typeof outputDir !== 'string' || !pathModule.isAbsolute(outputDir)) {
    throw new TypeError('Renderer vendor output directory must be an absolute path');
  }
  if (typeof fileSystem !== 'object' || typeof fileSystem.copyFileSync !== 'function'
      || typeof fileSystem.writeFileSync !== 'function') {
    throw new TypeError('Renderer vendor requires a file-system module');
  }

  fileSystem.mkdirSync(outputDir, { recursive: true });

  const files = Object.create(null);
  for (const source of sources) {
    const packagePath = pathModule.join(nodeModulesPath, source.pkg);
    if (!isRegularFile(pathModule.join(packagePath, 'package.json'), fileSystem)) {
      throw new Error(`Renderer dependency unavailable: ${source.pkg}`);
    }
    const sourcePath = pathModule.join(packagePath, source.dist);
    if (!isRegularFile(sourcePath, fileSystem)) {
      throw new Error(`Renderer dependency file unavailable: ${source.pkg}/${source.dist}`);
    }
    if (/\.map$/i.test(source.name)) {
      throw new Error(`Renderer vendor must not emit source maps: ${source.name}`);
    }
    const raw = fileSystem.readFileSync(sourcePath, 'utf8');
    const cleaned = stripSourceMapComment(raw);
    const destination = pathModule.join(outputDir, source.name);
    fileSystem.writeFileSync(destination, cleaned, { encoding: 'utf8', flag: 'w' });
    files[source.name] = sha256File(destination, fileSystem);
  }

  const record = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    files: Object.freeze(files),
  });
  const recordPath = pathModule.join(outputDir, 'integrity.json');
  fileSystem.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w',
  });
  return record;
}

if (require.main === module) {
  const result = buildRendererVendor();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  SCHEMA_VERSION,
  VENDOR_SOURCES,
  buildRendererVendor,
  sha256File,
};
