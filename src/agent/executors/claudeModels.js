'use strict';

const MINIMUM_CLAUDE_VERSION = '2.1.217';
const MODEL_IDS = Object.freeze(['fable', 'opus', 'sonnet']);
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

function parseVersion(output) {
  const match = typeof output === 'string' && output.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? match.slice(1).map(Number) : null;
}

function meetsMinimumVersion(output) {
  const version = parseVersion(output);
  const minimum = MINIMUM_CLAUDE_VERSION.split('.').map(Number);
  if (!version) return false;
  return version.some((part, index) => part !== minimum[index] && part > minimum[index])
    || version.every((part, index) => part === minimum[index]);
}

function listClaudeModels() {
  return MODEL_IDS.map((id) => ({ id, efforts: [...EFFORTS] }));
}

module.exports = { EFFORTS, MINIMUM_CLAUDE_VERSION, MODEL_IDS, listClaudeModels, meetsMinimumVersion, parseVersion };
