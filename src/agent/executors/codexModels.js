'use strict';

const MINIMUM_CODEX_VERSION = '0.144.6';
const MODEL_IDS = Object.freeze(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

function parseVersion(output) {
  const match = typeof output === 'string' && output.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function meetsMinimumVersion(output) {
  const version = parseVersion(output);
  const minimum = MINIMUM_CODEX_VERSION.split('.').map(Number);
  if (!version) return false;
  for (let i = 0; i < minimum.length; i++) {
    const part = version[i] || 0;
    const min = minimum[i] || 0;
    if (part > min) return true;
    if (part < min) return false;
  }
  return true;
}

function listCodexModels() {
  return MODEL_IDS.map((id) => ({ id, efforts: [...EFFORTS] }));
}

module.exports = { EFFORTS, MINIMUM_CODEX_VERSION, MODEL_IDS, listCodexModels, meetsMinimumVersion, parseVersion };
