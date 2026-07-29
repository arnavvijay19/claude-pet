'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const FORBIDDEN = new Map([
  ['connections.json', 'runtime-state'],
  ['sessions.json', 'runtime-state'],
  ['providers.json', 'runtime-state'],
  ['auth.json', 'auth-file'],
  ['credentials.json', 'auth-file'],
  ['.env', 'environment-file'],
  ['.git', 'development-tree'],
  ['.claude', 'development-tree'],
  ['.codex', 'development-tree'],
  ['.agents', 'development-tree'],
  ['docs', 'development-tree'],
  ['tests', 'development-tree'],
  ['scripts', 'development-tree'],
]);
const LEGACY_RENDERERS = new Set([
  'settingswindow.js',
  'settings-preload.js',
  'responsewindow.js',
  'response-preload.js',
]);
const TEXT_FILE = /\.(?:js|json|txt|md|html|css)$/i;
const SCAN_CHUNK_BYTES = 64 * 1024;
const SCAN_OVERLAP_CHARACTERS = 512;

function fail(relative, rule) {
  throw new Error(`${rule}: ${relative.replace(/\\/g, '/')}`);
}

function containsSecret(text) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|(?:ghp_|github_pat_|xoxb-|AKIA)[A-Za-z0-9_-]{12,}/i.test(text)) {
    return true;
  }
  for (const match of text.matchAll(/Bearer\s+([A-Za-z0-9._-]{16,})/gi)) {
    if (match[1] !== '__OWNER_BEARER__') return true;
  }
  return false;
}

function scanTextFile(full, relative, {
  openFile = fs.openSync,
  read = fs.readSync,
  close = fs.closeSync,
} = {}) {
  const descriptor = openFile(full, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
  let carry = '';
  try {
    while (true) {
      const bytesRead = read(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const text = carry + decoder.write(buffer.subarray(0, bytesRead));
      if (/['"](?:response|settings):[a-z-]+/.test(text)) fail(relative, 'legacy-channel');
      if (containsSecret(text)) fail(relative, 'secret-pattern');
      carry = text.slice(-SCAN_OVERLAP_CHARACTERS);
    }
    const tail = carry + decoder.end();
    if (/['"](?:response|settings):[a-z-]+/.test(tail)) fail(relative, 'legacy-channel');
    if (containsSecret(tail)) fail(relative, 'secret-pattern');
  } finally {
    close(descriptor);
  }
}

function verifyPackage(packageRoot, { walk = fs.readdirSync } = {}) {
  const root = path.resolve(packageRoot);
  let files = 0;
  let bytes = 0;
  const visit = (directory) => {
    for (const entry of walk(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink() || stat.isBlockDevice() || stat.isCharacterDevice()) {
        fail(relative, 'reparse-object');
      }
      const lowerName = entry.name.toLowerCase();
      const rule = FORBIDDEN.get(lowerName);
      if (rule) fail(relative, rule);
      if (LEGACY_RENDERERS.has(lowerName)) fail(relative, 'legacy-renderer');
      if (/\.map$/i.test(entry.name)) fail(relative, 'source-map-suffix');
      if (stat.isDirectory()) {
        visit(full);
        continue;
      }
      if (!stat.isFile()) fail(relative, 'unsupported-object');
      files += 1;
      bytes += stat.size;
      if (TEXT_FILE.test(entry.name)) scanTextFile(full, relative);
    }
  };
  visit(root);
  return Object.freeze({ files, bytes });
}

if (require.main === module) {
  const result = verifyPackage(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { verifyPackage, FORBIDDEN };
