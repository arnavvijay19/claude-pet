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

function safeText(value) {
  if (typeof value !== 'string' || value.length === 0) invalid();
  return sanitizeActivityValue({ text: value }).text;
}

function isPermissionFailure(value) {
  return /\b(permission|denied|blocked|approval)\b/i.test(value);
}

function mapAssistant(message) {
  if (!message || typeof message !== 'object' || !Array.isArray(message.content)) invalid();
  let visible = null;
  for (const item of message.content) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') invalid();
    if (item.type === 'thinking') continue;
    if (item.type === 'tool_use') {
      if (typeof item.name !== 'string' || !item.name) invalid();
      visible ||= { activity: cleanEvent({ phase: 'running', kind: 'tool', summary: `Claude used ${item.name}`, toolName: item.name }) };
      continue;
    }
    if (item.type === 'text') {
      if (typeof item.text !== 'string') invalid();
      visible ||= { activity: cleanEvent({ phase: 'responding', kind: 'status', summary: 'Claude response received', status: 'responding' }) };
      continue;
    }
    invalid();
  }
  return visible;
}

function mapClaudeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') invalid();
  if (event.type === 'system' && event.subtype === 'init') {
    return { activity: cleanEvent({ phase: 'preparing', kind: 'status', summary: 'Claude session started', status: 'preparing' }) };
  }
  if (event.type === 'assistant') return mapAssistant(event.message);
  if (event.type === 'user') return null;
  if (event.type === 'result') {
    const text = safeText(event.result);
    if (event.subtype === 'success') {
      return { activity: cleanEvent({ phase: 'responding', kind: 'message', summary: 'Claude response ready' }), responseText: text };
    }
    if (event.subtype === 'error') {
      if (isPermissionFailure(text)) {
        return { activity: cleanEvent({ phase: 'running', kind: 'permission', summary: 'Claude reported a permission error', permission: 'workspace', decision: 'blocked' }), error: 'PERMISSION_BLOCKED' };
      }
      return { activity: cleanEvent({ phase: 'running', kind: 'status', summary: 'Claude reported an error', status: 'error' }), error: 'COMMAND_FAILED' };
    }
    invalid();
  }
  invalid();
}

module.exports = { mapClaudeEvent };
