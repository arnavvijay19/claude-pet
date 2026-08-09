#!/usr/bin/env node
'use strict';
/*
 * Guard against the recurring npm-extraction/prune bug that silently drops
 * files from node_modules (notably jsdom and the TooTallNate proxy-agents),
 * which otherwise produces a confusing cascade of "Cannot find module"
 * failures in `npm test` instead of one clear diagnosis.
 *
 *   node scripts/ensure-deps.cjs --check    detect only; exit 1 if broken (used by `pretest`)
 *   node scripts/ensure-deps.cjs --restore  detect; attempt a fresh-cache npm auto-restore;
 *                                         exit 1 if still broken (used by `npm run doctor`)
 *
 * NOTE: jsdom's entry is `lib/api.js` (NOT `lib/index.js`). The TooTallNate
 * proxy-agents ship `dist/index.js`. Probe those exact files.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = 'node_modules';

// Packages the extraction bug tends to corrupt, keyed to the entry file whose
// presence/absence best reflects a usable install.
const FRAGILE = [
  { name: 'jsdom', probe: 'lib/api.js' },
  { name: 'http-proxy-agent', probe: 'dist/index.js' },
  { name: 'https-proxy-agent', probe: 'dist/index.js' },
  { name: 'agent-base', probe: 'dist/index.js' },
];

function detectBroken() {
  const broken = [];
  for (const { name, probe } of FRAGILE) {
    const dir = path.join(ROOT, PKG, name);
    const entry = path.join(dir, probe);
    if (!fs.existsSync(dir)) {
      broken.push(`${name} (entirely missing)`);
      continue;
    }
    if (!fs.existsSync(entry)) {
      broken.push(`${name} (missing ${probe})`);
      continue;
    }
    // Last-resort: actually load it. A partially-dropped internal file fails here.
    try {
      require(path.join(ROOT, PKG, name));
    } catch (e) {
      broken.push(`${name} (require failed: ${String(e.message).split('\n')[0]})`);
    }
  }
  return broken;
}

function attemptRestore() {
  const fresh = path.join(os.tmpdir(), `claude-pet-npmcache-restore-${Date.now()}`);
  const npm = (process.env.npm_execpath && !process.env.npm_execpath.includes('npm-cli.js'))
    ? process.env.npm_execpath
    : 'npm';
  try {
    const r = spawnSync(
      npm,
      ['install', '--cache', fresh, '--prefer-online', '--force', '--no-audit', '--no-fund'],
      { cwd: ROOT, stdio: 'inherit', env: process.env, timeout: 1000 * 60 * 8 }
    );
    return r.status === 0;
  } catch (e) {
    console.error('[ensure-deps] restore spawn failed:', e.message);
    return false;
  }
}

const mode = process.argv.includes('--restore') ? 'restore' : 'check';
const broken = detectBroken();

if (broken.length === 0) {
  console.log('[ensure-deps] all fragile dependencies present and loadable.');
  process.exit(0);
}

console.error('\n[ensure-deps] CORRUPTED node_modules detected:');
broken.forEach((b) => console.error('  - ' + b));
console.error('\nLikely cause: the npm-extraction/prune bug dropping files from node_modules.');
console.error('Fix (manual):  npm install --cache <fresh-dir> --prefer-online --force');
console.error('Fix (auto):    npm run doctor\n');

if (mode === 'restore') {
  console.error('[ensure-deps] attempting auto-restore via fresh-cache npm install...');
  const ok = attemptRestore();
  if (ok) {
    const still = detectBroken();
    if (still.length === 0) {
      console.log('[ensure-deps] restored successfully.');
      process.exit(0);
    }
    console.error('[ensure-deps] restore ran but deps still broken:', still.join('; '));
  } else {
    console.error('[ensure-deps] auto-restore failed (no npm/egress?). Use the manual fix above.');
  }
}

process.exit(1);
