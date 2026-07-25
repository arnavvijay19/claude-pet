'use strict';

const MINIMUM_CODEX_VERSION = '0.144.6';
const MODEL_IDS = Object.freeze(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

function parseVersion(output) {
  const match = typeof output === 'string' && output.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? match.slice(1).map(Number) : null;
}

function meetsMinimumVersion(output) {
  const version = parseVersion(output);
  const minimum = MINIMUM_CODEX_VERSION.split('.').map(Number);
  if (!version) return false;
  return version.some((part, index) => part !== minimum[index] && part > minimum[index])
    || version.every((part, index) => part === minimum[index]);
}

function listCodexModels() {
  return MODEL_IDS.map((id) => ({ id, efforts: [...EFFORTS] }));
}

module.exports = { EFFORTS, MINIMUM_CODEX_VERSION, MODEL_IDS, listCodexModels, meetsMinimumVersion, parseVersion };
