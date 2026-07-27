'use strict';

const path = require('node:path');

const TOP_LEVEL_KEYS = Object.freeze([
  'description',
  'displayName',
  'frameHeight',
  'frameWidth',
  'id',
  'spritesheetPath',
  'states',
]);
const STATE_KEYS = Object.freeze(['frameCount', 'frameDurationMs', 'loop', 'nextState', 'row']);
const STATE_NAMES = Object.freeze([
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
]);
const MIME_BY_EXTENSION = Object.freeze({ '.png': 'image/png', '.webp': 'image/webp' });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function invalidManifest() {
  throw new Error('Invalid pet manifest');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected, optional = []) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const allowed = new Set([...expected, ...optional]);
  if (actual.some((key) => !allowed.has(key))) return false;
  return expected.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateManifest(manifest) {
  if (!hasExactKeys(manifest, TOP_LEVEL_KEYS)) invalidManifest();
  if (!isNonEmptyString(manifest.id)
      || !isNonEmptyString(manifest.displayName)
      || !isNonEmptyString(manifest.description)
      || !isNonEmptyString(manifest.spritesheetPath)) invalidManifest();
  if (manifest.frameWidth !== 192 || manifest.frameHeight !== 208) invalidManifest();
  if (path.basename(manifest.spritesheetPath) !== manifest.spritesheetPath) invalidManifest();

  const stateNames = isPlainObject(manifest.states) ? Object.keys(manifest.states) : [];
  if (stateNames.length !== STATE_NAMES.length
      || stateNames.some((name) => !STATE_NAMES.includes(name))
      || STATE_NAMES.some((name) => !Object.hasOwn(manifest.states, name))) invalidManifest();

  const rows = new Set();
  for (const name of STATE_NAMES) {
    const state = manifest.states[name];
    if (!hasExactKeys(state, ['row', 'frameCount', 'frameDurationMs', 'loop'], ['nextState'])) {
      invalidManifest();
    }
    if (!Number.isInteger(state.row) || state.row < 0 || state.row >= STATE_NAMES.length) invalidManifest();
    if (rows.has(state.row)) invalidManifest();
    rows.add(state.row);
    if (!Number.isInteger(state.frameCount) || state.frameCount < 1 || state.frameCount > 8) invalidManifest();
    if (!Number.isInteger(state.frameDurationMs) || state.frameDurationMs < 1) invalidManifest();
    if (typeof state.loop !== 'boolean') invalidManifest();
    if (Object.hasOwn(state, 'nextState')) {
      if (!isNonEmptyString(state.nextState) || !STATE_NAMES.includes(state.nextState)) invalidManifest();
    }
  }

  return manifest;
}

function hasMatchingSignature(extension, bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (extension === '.png') {
    return bytes.length >= PNG_SIGNATURE.length
      && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  }
  if (extension === '.webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function loadPetManifestWithDataUrl({ assetsDir, readFileSync }) {
  if (!isNonEmptyString(assetsDir) || typeof readFileSync !== 'function') invalidManifest();

  try {
    const diskManifest = validateManifest(JSON.parse(readFileSync(path.join(assetsDir, 'pet.json'), 'utf8')));
    const extension = path.extname(diskManifest.spritesheetPath).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension];
    if (!mime) invalidManifest();
    const bytes = readFileSync(path.join(assetsDir, diskManifest.spritesheetPath));
    if (!hasMatchingSignature(extension, bytes)) invalidManifest();

    const states = {};
    for (const name of STATE_NAMES) states[name] = { ...diskManifest.states[name] };
    return deepFreeze({
      ...diskManifest,
      states,
      spritesheetDataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    });
  } catch (error) {
    if (error?.message === 'Invalid pet manifest') throw error;
    invalidManifest();
  }
}

module.exports = { loadPetManifestWithDataUrl };
