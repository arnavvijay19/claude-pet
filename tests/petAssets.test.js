'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPetManifestWithDataUrl } = require('../src/petAssets.js');

const EXPECTED_STATES = Object.freeze({
  idle:            { row: 0, frameCount: 6, frameDurationMs: 180, loop: true },
  'running-right': { row: 1, frameCount: 8, frameDurationMs: 90,  loop: true },
  'running-left':  { row: 2, frameCount: 8, frameDurationMs: 90,  loop: true },
  waving:          { row: 3, frameCount: 4, frameDurationMs: 140, loop: false, nextState: 'idle' },
  jumping:         { row: 4, frameCount: 5, frameDurationMs: 110, loop: false, nextState: 'running' },
  failed:          { row: 5, frameCount: 8, frameDurationMs: 130, loop: false, nextState: 'idle' },
  waiting:         { row: 6, frameCount: 6, frameDurationMs: 180, loop: true },
  running:         { row: 7, frameCount: 6, frameDurationMs: 110, loop: true },
  review:          { row: 8, frameCount: 6, frameDurationMs: 160, loop: true },
});

const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBP', 'ascii'),
]);

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function expectedManifest(overrides = {}) {
  return {
    id: 'post-hoc-banana-baron',
    displayName: 'Post-Hoc Banana Baron',
    description: 'A mischievous pixel-art monkey with sunglasses, a banana, and a money bundle.',
    spritesheetPath: 'spritesheet.webp',
    frameWidth: 192,
    frameHeight: 208,
    states: structuredClone(EXPECTED_STATES),
    ...overrides,
  };
}

function withAssets(manifest, imageBytes, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-assets-'));
  try {
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.writeFileSync(path.join(root, 'pet.json'), manifestBytes, 'utf8');
    if (path.basename(manifest.spritesheetPath) === manifest.spritesheetPath) {
      fs.writeFileSync(path.join(root, manifest.spritesheetPath), imageBytes);
    }
    return run(root, manifestBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('loads the committed nine-state WebP contract as a recursively frozen data manifest', () => {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const manifest = loadPetManifestWithDataUrl({ assetsDir, readFileSync: fs.readFileSync });

  assert.equal(manifest.spritesheetPath, 'spritesheet.webp');
  assert.equal(manifest.spritesheetDataUrl.startsWith('data:image/webp;base64,'), true);
  assert.deepEqual(manifest.states, EXPECTED_STATES);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.states), true);
  for (const state of Object.values(manifest.states)) assert.equal(Object.isFrozen(state), true);
});

test('loads a valid PNG with the matching MIME and leaves the disk manifest unchanged', () => {
  const diskManifest = expectedManifest({ spritesheetPath: 'spritesheet.png' });
  withAssets(diskManifest, PNG_BYTES, (assetsDir, originalBytes) => {
    const manifest = loadPetManifestWithDataUrl({ assetsDir, readFileSync: fs.readFileSync });
    assert.equal(manifest.spritesheetDataUrl, `data:image/png;base64,${PNG_BYTES.toString('base64')}`);
    assert.equal(fs.readFileSync(path.join(assetsDir, 'pet.json'), 'utf8'), originalBytes);
    assert.equal(Object.hasOwn(diskManifest, 'spritesheetDataUrl'), false);
  });
});

test('rejects traversal, unknown extensions, and image bytes that do not match the suffix', () => {
  const cases = [
    [expectedManifest({ spritesheetPath: '../outside.webp' }), WEBP_BYTES],
    [expectedManifest({ spritesheetPath: 'spritesheet.gif' }), Buffer.from('GIF89a', 'ascii')],
    [expectedManifest(), PNG_BYTES],
    [expectedManifest({ spritesheetPath: 'spritesheet.png' }), WEBP_BYTES],
  ];

  for (const [manifest, bytes] of cases) {
    withAssets(manifest, bytes, (assetsDir) => {
      assert.throws(
        () => loadPetManifestWithDataUrl({ assetsDir, readFileSync: fs.readFileSync }),
        /Invalid pet manifest/,
      );
    });
  }
});
test('rejects unknown keys, states, duplicate rows, and invalid geometry', () => {
  const unknownKey = expectedManifest({ extra: true });
  const unknownState = expectedManifest();
  unknownState.states.sleeping = { row: 9, frameCount: 1, frameDurationMs: 100, loop: true };
  const duplicateRow = expectedManifest();
  duplicateRow.states.review.row = 7;
  const invalidFrameWidth = expectedManifest({ frameWidth: 0 });
  const tooManyFrames = expectedManifest();
  tooManyFrames.states.idle.frameCount = 9;
  const unknownStateKey = expectedManifest();
  unknownStateKey.states.idle.speed = 1;

  for (const manifest of [unknownKey, unknownState, duplicateRow, invalidFrameWidth, tooManyFrames, unknownStateKey]) {
    withAssets(manifest, WEBP_BYTES, (assetsDir) => {
      assert.throws(
        () => loadPetManifestWithDataUrl({ assetsDir, readFileSync: fs.readFileSync }),
        /Invalid pet manifest/,
      );
    });
  }
});
