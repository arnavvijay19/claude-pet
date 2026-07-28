'use strict';

const MAXIMUM_BYTES = 65536;
const MAXIMUM_TURNS = 24;
const MAXIMUM_TURN_BYTES = 8192;
const MAXIMUM_INSTRUCTION_BYTES = 2000;

function invalid() {
  throw new TypeError('Invalid neutral session context');
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wellFormedString(value) {
  return typeof value === 'string' && !value.includes('\0')
    && (typeof value.isWellFormed !== 'function' || value.isWellFormed());
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validChangedFile(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)
    && !value.split(/[\\/]+/).includes('..');
}

function validateAgents(agents, activeAgent) {
  if (!Array.isArray(agents) || !exactKeys(activeAgent, ['id', 'name', 'instruction'])
      || !wellFormedString(activeAgent.id) || !activeAgent.id
      || !wellFormedString(activeAgent.name) || !activeAgent.name
      || !wellFormedString(activeAgent.instruction)
      || Buffer.byteLength(activeAgent.instruction, 'utf8') > MAXIMUM_INSTRUCTION_BYTES) invalid();
  const ids = new Set();
  const names = new Map();
  for (const agent of agents) {
    if (!exactKeys(agent, ['id', 'name'])
        || !wellFormedString(agent.id) || !agent.id
        || !wellFormedString(agent.name) || !agent.name
        || ids.has(agent.id)) invalid();
    ids.add(agent.id);
    names.set(agent.id, agent.name);
  }
  if (!ids.has(activeAgent.id)) invalid();
  return { ids, names };
}

function validateTurn(turn, agentIds) {
  if (!exactKeys(turn, [
    'role', 'text', 'agentId', 'provider', 'model', 'changedFiles', 'createdAt',
  ])
      || (turn.role !== 'user' && turn.role !== 'assistant')
      || !wellFormedString(turn.text)
      || Buffer.byteLength(turn.text, 'utf8') > MAXIMUM_TURN_BYTES
      || !wellFormedString(turn.agentId) || !agentIds.has(turn.agentId)
      || !wellFormedString(turn.createdAt) || !turn.createdAt
      || !Array.isArray(turn.changedFiles)
      || turn.changedFiles.some((value) => !validChangedFile(value))) invalid();
  if (turn.role === 'user'
      && (turn.provider !== null || turn.model !== null || turn.changedFiles.length !== 0)) invalid();
  if (turn.role === 'assistant'
      && (!wellFormedString(turn.provider) || !turn.provider
        || !wellFormedString(turn.model) || !turn.model)) invalid();
}

function renderTurn(turn, agentNames) {
  const agentName = escapeXml(agentNames.get(turn.agentId));
  const header = turn.role === 'user'
    ? `[Agent: ${agentName} | Role: user]`
    : `[Agent: ${agentName} | Provider: ${escapeXml(turn.provider)} | Model: ${escapeXml(turn.model)}]`;
  return `${header}\n${escapeXml(turn.text)}`;
}

function render({
  turns, agentNames, activeAgent, currentText, omitted,
}) {
  const lines = [
    '<claude_pet_active_agent>',
    `Name: ${escapeXml(activeAgent.name)}`,
    `Instruction: ${escapeXml(activeAgent.instruction)}`,
    '</claude_pet_active_agent>',
    '<claude_pet_session_history>',
  ];
  if (omitted) lines.push('[Older session turns omitted by Claude Pet.]');
  for (const turn of turns) lines.push(renderTurn(turn, agentNames));
  lines.push(
    '</claude_pet_session_history>',
    '<claude_pet_current_request>',
    escapeXml(currentText),
    '</claude_pet_current_request>',
  );
  return lines.join('\n');
}

function buildNeutralSessionPrompt({
  turns,
  agents,
  activeAgent,
  currentText,
  maximumBytes = MAXIMUM_BYTES,
  maximumTurns = MAXIMUM_TURNS,
} = {}) {
  if (!Array.isArray(turns) || !wellFormedString(currentText)
      || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAXIMUM_BYTES
      || !Number.isSafeInteger(maximumTurns) || maximumTurns <= 0 || maximumTurns > MAXIMUM_TURNS
      || Buffer.byteLength(currentText, 'utf8') > MAXIMUM_BYTES) invalid();
  const { ids, names } = validateAgents(agents, activeAgent);
  turns.forEach((turn) => validateTurn(turn, ids));
  const kept = [];
  for (let index = turns.length - 1; index >= 0 && kept.length < maximumTurns; index -= 1) {
    const candidate = turns[index];
    const next = [candidate, ...kept];
    const prompt = render({
      turns: next,
      agentNames: names,
      activeAgent,
      currentText,
      omitted: next.length < turns.length,
    });
    if (Buffer.byteLength(prompt, 'utf8') > maximumBytes) break;
    kept.unshift(candidate);
  }
  const result = render({
    turns: kept,
    agentNames: names,
    activeAgent,
    currentText,
    omitted: kept.length < turns.length,
  });
  if (Buffer.byteLength(result, 'utf8') > maximumBytes) invalid();
  return result;
}

module.exports = {
  MAXIMUM_BYTES,
  MAXIMUM_INSTRUCTION_BYTES,
  MAXIMUM_TURNS,
  buildNeutralSessionPrompt,
};
