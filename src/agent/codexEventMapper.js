'use strict';

const { AgentError } = require('./agentErrors.js');
const { sanitizeActivityValue } = require('./activitySanitizer.js');
const { validateActivityEvent } = require('./activitySchema.js');

function invalid() { throw new AgentError('PROVIDER_OUTPUT_INVALID'); }

function cleanEvent(event) {
  try {
    return validateActivityEvent(sanitizeActivityValue(event));
  } catch (error) {
    if (error instanceof AgentError) throw new AgentError('PROVIDER_OUTPUT_INVALID', { cause: error });
    throw error;
  }
}

function fileOperation(kind) {
  if (kind === 'add' || kind === 'create') return 'create';
  if (kind === 'delete' || kind === 'remove') return 'delete';
  return 'modify';
}

function mapItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.type !== 'string') invalid();
  if (item.type === 'reasoning') return null;
  if (item.type === 'agent_message') {
    if (typeof item.text !== 'string' || item.text.length === 0) invalid();
    const text = sanitizeActivityValue({ text: item.text }).text;
    return { activity: cleanEvent({ phase: 'responding', kind: 'message', summary: 'Codex response ready' }), responseText: text };
  }
  if (item.type === 'command_execution') {
    if (typeof item.command !== 'string' || !Number.isInteger(item.exit_code)) invalid();
    return { activity: cleanEvent({
      phase: 'running', kind: 'command', summary: 'Codex command completed', command: item.command,
      exitCode: item.exit_code, ...(typeof item.aggregated_output === 'string' && item.aggregated_output ? { detail: item.aggregated_output } : {}),
    }) };
  }
  if (item.type === 'file_change') {
    if (!Array.isArray(item.changes) || item.changes.length === 0) invalid();
    const change = item.changes[0];
    if (!change || typeof change.path !== 'string' || typeof change.kind !== 'string') invalid();
    const operation = fileOperation(change.kind);
    return { activity: cleanEvent({ phase: 'running', kind: 'file', summary: `Codex ${operation === 'modify' ? 'modified' : `${operation}d`} ${change.path}`, path: change.path, operation }), changedFiles: [change.path] };
  }
  if (item.type === 'mcp_tool_call') {
    const name = item.tool || item.name;
    if (typeof name !== 'string' || !name) invalid();
    return { activity: cleanEvent({ phase: 'running', kind: 'tool', summary: 'Codex used an MCP tool', toolName: name }) };
  }
  if (item.type === 'web_search') {
    if (typeof item.query !== 'string' || !item.query) invalid();
    return { activity: cleanEvent({ phase: 'running', kind: 'network', summary: 'Codex requested web search', destination: 'https://search.openai.com' }) };
  }
  return null;
}

function mapCodexEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') invalid();
  if (event.type === 'thread.started') return { activity: cleanEvent({ phase: 'preparing', kind: 'status', summary: 'Codex thread started', status: 'preparing' }) };
  if (event.type === 'turn.started') return { activity: cleanEvent({ phase: 'running', kind: 'status', summary: 'Codex turn started', status: 'running' }) };
  if (event.type === 'turn.completed') return { activity: cleanEvent({ phase: 'responding', kind: 'status', summary: 'Codex turn completed', status: 'responding' }) };
  if (event.type === 'item.completed') return mapItem(event.item);
  if (event.type === 'item.started' || event.type === 'item.updated') return event.item?.type === 'reasoning' ? null : { activity: cleanEvent({ phase: 'running', kind: 'status', summary: 'Codex updated activity', status: 'running' }) };
  if (event.type === 'error') {
    if (typeof event.message !== 'string' || !event.message) invalid();
    return { activity: cleanEvent({ phase: 'running', kind: 'permission', summary: 'Codex reported an error', permission: 'workspace', decision: 'blocked', detail: event.message }), error: event.message };
  }
  invalid();
}

module.exports = { mapCodexEvent };
