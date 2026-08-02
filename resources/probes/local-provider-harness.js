'use strict';

const crypto = require('node:crypto');

const FIXTURE_SCHEMA_VERSION = 1;
const USAGE = Object.freeze({
  input_tokens: 1,
  input_tokens_details: Object.freeze({ cached_tokens: 0 }),
  output_tokens: 1,
  output_tokens_details: Object.freeze({ reasoning_tokens: 0 }),
  total_tokens: 2,
});

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function keys(value) {
  return plain(value) ? Object.keys(value).sort() : [];
}

function formalExecRegistry(description) {
  if (typeof description !== 'string') return [];
  return description.split(/\r?\n/).filter((line) => line.startsWith('### ')).map((line) => {
    const match = /^###\s+`?([A-Za-z0-9_.:-]+)`?/.exec(line);
    return match?.[1] || null;
  }).filter(Boolean);
}

function validateFixtureShape(provider, fixture) {
  if (!plain(fixture) || fixture.schemaVersion !== FIXTURE_SCHEMA_VERSION
      || fixture.provider !== provider || typeof fixture.version !== 'string'
      || !plain(fixture.protocol) || !plain(fixture.sse) || !plain(fixture.scenario)
      || !Array.isArray(fixture.scenario.calls)
      || fixture.scenario.calls.some((call) => !plain(call)
        || typeof call.id !== 'string' || typeof call.name !== 'string')
      || typeof fixture.scenario.goal !== 'string'
      || fixture.scenario.goal !== 'Run the fixed local provider probe.'
      || fixture.scenario.finalText !== 'probe-complete') {
    throw new Error('Invalid provider fixture');
  }
  if (provider === 'codex-cli') {
    if (fixture.version !== '0.145.0'
      || !Array.isArray(fixture.protocol.additionalTools)
      || !Array.isArray(fixture.protocol.execRegistry)
      || !Array.isArray(fixture.protocol.collaborationTools)
      || fixture.scenario.calls.length !== 9) throw new Error('Invalid Codex fixture');
  } else if (provider === 'claude-code-cli') {
    if (fixture.version !== '2.1.217'
      || !Array.isArray(fixture.protocol.tools)
      || fixture.scenario.calls.length !== 3) throw new Error('Invalid Claude fixture');
  } else {
    throw new Error('Unknown provider fixture');
  }
  return fixture;
}

function validateCodexEnvelope(body, fixture) {
  const protocol = fixture.protocol;
  if (!plain(body) || !same(keys(body), protocol.bodyKeys)
      || body.model !== protocol.model || body.stream !== protocol.stream
      || body.store !== protocol.store
      || body.parallel_tool_calls !== protocol.parallelToolCalls
      || body.tool_choice !== protocol.toolChoice
      || !same(body.include, protocol.include)
      || (protocol.classicToolsForbidden && Object.hasOwn(body, 'tools'))
      || !Array.isArray(body.input) || body.input.length < protocol.inputProjection.length) {
    throw new Error('Unexpected Codex Responses envelope');
  }
  const projectedItems = body.input.slice(0, protocol.inputProjection.length);
  const projectedMessages = projectedItems.filter((item) => item?.type === 'message');
  const identifiedMessages = projectedMessages.filter((item) => Object.hasOwn(item, 'id'));
  if (identifiedMessages.some((item) => typeof item.id !== 'string'
      || item.id.length === 0 || item.id.length > 256 || item.id.includes('\0'))
      || new Set(identifiedMessages.map((item) => item.id)).size !== identifiedMessages.length) {
    throw new Error('Unexpected Codex item identifier');
  }
  const projection = projectedItems.map((item) => ({
    type: item?.type,
    role: item?.role,
    keys: keys(item).filter((key) => key !== 'id'),
  }));
  if (!same(projection, protocol.inputProjection)) {
    throw new Error('Unexpected Codex input projection');
  }
  const additional = body.input.filter((item) => item?.type === 'additional_tools');
  if (additional.length !== 1 || additional[0].role !== 'developer'
      || !Array.isArray(additional[0].tools)
      || additional[0].tools.length !== protocol.additionalTools.length) {
    throw new Error('Unexpected Codex additional tools');
  }
  for (let index = 0; index < protocol.additionalTools.length; index += 1) {
    const actual = additional[0].tools[index];
    const expected = protocol.additionalTools[index];
    if (actual?.name !== expected.name || actual?.type !== expected.type
        || !same(keys(actual), expected.keys)
        || sha256(actual.description || '') !== expected.descriptionSha256
        || (expected.parametersSha256
          && sha256(actual.parameters || null) !== expected.parametersSha256)) {
      throw new Error('Unexpected Codex tool schema');
    }
  }
  const exec = additional[0].tools.find((tool) => tool.name === 'exec');
  if (!exec || exec.format?.type !== 'grammar' || exec.format?.syntax !== 'lark'
      || exec.format?.definition !== protocol.execGrammar
      || !same(formalExecRegistry(exec.description), protocol.execRegistry)) {
    throw new Error('Unexpected Codex exec registry');
  }
  const collaboration = additional[0].tools.find((tool) => tool.name === 'collaboration');
  if (!collaboration || !Array.isArray(collaboration.tools)
      || !same(collaboration.tools.map((tool) => tool.name), protocol.collaborationTools)) {
    throw new Error('Unexpected Codex collaboration registry');
  }
  for (let index = 0; index < protocol.collaborationSchemas.length; index += 1) {
    const actual = collaboration.tools[index];
    const expected = protocol.collaborationSchemas[index];
    if (actual?.name !== expected.name
      || sha256(actual.parameters || null) !== expected.parametersSha256) {
      throw new Error('Unexpected Codex collaboration schema');
    }
  }
}

function validateClaudeEnvelope(body, fixture) {
  const protocol = fixture.protocol;
  if (!plain(body) || !same(keys(body), protocol.bodyKeys)
      || body.model !== protocol.model || body.stream !== protocol.stream
      || body.max_tokens !== protocol.maxTokens
      || !Array.isArray(body.tools)
      || !same(body.tools.map((tool) => tool.name), protocol.toolOrder)
      || !Array.isArray(body.system) || body.system.length !== protocol.systemBlocks.length
      || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('Unexpected Claude Messages envelope');
  }
  for (let index = 0; index < protocol.tools.length; index += 1) {
    const actual = body.tools[index];
    const expected = protocol.tools[index];
    if (actual?.name !== expected.name
      || !same(keys(actual), ['description', 'input_schema', 'name'])
      || sha256(actual.description || '') !== expected.descriptionSha256
      || sha256(actual.input_schema || null) !== expected.inputSchemaSha256) {
      throw new Error('Unexpected Claude tool schema');
    }
  }
  for (let index = 0; index < protocol.systemBlocks.length; index += 1) {
    if (!same(keys(body.system[index]), protocol.systemBlocks[index].keys)) {
      throw new Error('Unexpected Claude system block');
    }
  }
  const first = body.messages[0];
  if (first?.role !== protocol.initialMessage.role || !Array.isArray(first.content)
      || !same(first.content.map((item) => item?.type), protocol.initialMessage.contentTypes)) {
    throw new Error('Unexpected Claude initial message');
  }
}

function responseBase(id, model, status, output, usage = null) {
  return {
    id,
    object: 'response',
    created_at: 1,
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output,
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: { effort: 'high', summary: null },
    store: false,
    temperature: null,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    truncation: 'disabled',
    usage,
    user: null,
    metadata: {},
  };
}

function codexCustomToolEvents(model, call) {
  const responseId = 'probe_response_exec';
  const itemId = 'probe_item_exec';
  const pending = {
    id: itemId, type: 'custom_tool_call', status: 'in_progress',
    call_id: call.id, name: call.name, input: '',
  };
  const completed = { ...pending, status: 'completed', input: call.input };
  return [
    { type: 'response.created', response: responseBase(responseId, model, 'in_progress', []) },
    { type: 'response.output_item.added', response_id: responseId, output_index: 0, item: pending },
    { type: 'response.custom_tool_call_input.delta', response_id: responseId, item_id: itemId, output_index: 0, delta: call.input },
    { type: 'response.custom_tool_call_input.done', response_id: responseId, item_id: itemId, output_index: 0, input: call.input },
    { type: 'response.output_item.done', response_id: responseId, output_index: 0, item: completed },
    { type: 'response.completed', response: responseBase(responseId, model, 'completed', [completed], USAGE) },
  ];
}

function codexFunctionEvents(model, calls, suffix) {
  const responseId = `probe_response_${suffix}`;
  const output = [];
  const events = [
    { type: 'response.created', response: responseBase(responseId, model, 'in_progress', []) },
  ];
  calls.forEach((call, outputIndex) => {
    const itemId = `probe_item_${suffix}_${outputIndex}`;
    const argumentText = JSON.stringify(call.arguments);
    const pending = {
      id: itemId, type: 'function_call', status: 'in_progress',
      call_id: call.id, name: call.name, arguments: '',
    };
    const completed = { ...pending, status: 'completed', arguments: argumentText };
    output.push(completed);
    events.push(
      { type: 'response.output_item.added', response_id: responseId, output_index: outputIndex, item: pending },
      { type: 'response.function_call_arguments.delta', response_id: responseId, item_id: itemId, output_index: outputIndex, delta: argumentText },
      { type: 'response.function_call_arguments.done', response_id: responseId, item_id: itemId, output_index: outputIndex, arguments: argumentText },
      { type: 'response.output_item.done', response_id: responseId, output_index: outputIndex, item: completed },
    );
  });
  events.push({
    type: 'response.completed',
    response: responseBase(responseId, model, 'completed', output, USAGE),
  });
  return events;
}

function codexTextEvents(model, text) {
  const responseId = 'probe_response_final';
  const itemId = 'probe_item_final';
  const content = { type: 'output_text', text, annotations: [], logprobs: [] };
  const completed = {
    id: itemId, type: 'message', status: 'completed', role: 'assistant', content: [content],
  };
  return [
    { type: 'response.created', response: responseBase(responseId, model, 'in_progress', []) },
    { type: 'response.output_item.added', response_id: responseId, output_index: 0, item: { ...completed, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: { ...content, text: '' } },
    { type: 'response.output_text.delta', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, delta: text, logprobs: [] },
    { type: 'response.output_text.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, text, logprobs: [] },
    { type: 'response.content_part.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: content },
    { type: 'response.output_item.done', response_id: responseId, output_index: 0, item: completed },
    { type: 'response.completed', response: responseBase(responseId, model, 'completed', [completed], USAGE) },
  ];
}

function claudeMessageStart(model, id) {
  return {
    type: 'message_start',
    message: {
      id, type: 'message', role: 'assistant', content: [], model,
      stop_reason: null, stop_sequence: null,
      usage: {
        input_tokens: 1, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 1, service_tier: 'standard',
      },
    },
  };
}

function claudeToolEvents(model, calls) {
  const events = [['message_start', claudeMessageStart(model, 'probe_claude_tools')]];
  calls.forEach((call, index) => {
    events.push(
      ['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } }],
      ['content_block_stop', { type: 'content_block_stop', index }],
    );
  });
  events.push(
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  );
  return events;
}

function claudeTextEvents(model, text) {
  return [
    ['message_start', claudeMessageStart(model, 'probe_claude_final')],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
}

function encodeSse(provider, events, limits) {
  if (!Array.isArray(events) || events.length === 0 || events.length > limits.events) {
    throw new Error('Probe SSE event cap exceeded');
  }
  const chunks = events.map((entry) => {
    const name = provider === 'codex-cli' ? entry.type : entry[0];
    const value = provider === 'codex-cli' ? entry : entry[1];
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data, 'utf8') > limits.eventBytes) {
      throw new Error('Probe SSE event size exceeded');
    }
    return `event: ${name}\ndata: ${data}\n\n`;
  });
  if (provider === 'codex-cli') chunks.push('data: [DONE]\n\n');
  return chunks.join('');
}

function replaceOwnerValues(value, replacements) {
  if (typeof value === 'string') {
    let result = value;
    for (const [placeholder, replacement] of Object.entries(replacements)) {
      result = result.split(placeholder).join(replacement);
    }
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => replaceOwnerValues(item, replacements));
  if (plain(value)) {
    return Object.fromEntries(Object.entries(value)
      .map(([name, item]) => [name, replaceOwnerValues(item, replacements)]));
  }
  return value;
}

function resultText(item) {
  if (!item) return '';
  return typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
}

function assertCodexFailClosedResults(results, calls) {
  if (!Array.isArray(results) || !Array.isArray(calls)) {
    throw new Error('Codex controls did not fail closed');
  }
  const expectedIds = new Set(calls.map((call) => call?.id));
  const relevant = results.filter((result) => expectedIds.has(result?.call_id));
  if (expectedIds.size !== calls.length || relevant.length !== calls.length) {
    throw new Error('Codex controls did not fail closed');
  }
  for (const call of calls) {
    const matches = relevant.filter((result) => result?.call_id === call.id);
    const expected = call.name === 'request_user_input'
      ? 'request_user_input is unavailable in Default mode'
      : `unsupported call: ${call.name}`;
    if (matches.length !== 1 || matches[0].type !== 'function_call_output'
        || resultText(matches[0]) !== expected) {
      throw new Error('Codex controls did not fail closed');
    }
  }
  return true;
}

function claudeResultText(result) {
  if (typeof result?.content === 'string') return result.content;
  if (Array.isArray(result?.content)) {
    return result.content.map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item?.text === 'string') return item.text;
      return JSON.stringify(item);
    }).join('\n');
  }
  return JSON.stringify(result?.content);
}

function assertClaudeToolResults(results, calls) {
  if (!Array.isArray(results) || !Array.isArray(calls)) {
    throw new Error('Claude sentinel result is invalid');
  }
  const expectedIds = new Set(calls.map((call) => call?.id));
  const relevant = results.filter((result) => expectedIds.has(result?.tool_use_id));
  if (expectedIds.size !== calls.length || relevant.length !== calls.length) {
    throw new Error('Claude sentinel result is invalid');
  }
  for (const call of calls) {
    const matches = relevant.filter((result) => result?.tool_use_id === call.id);
    if (matches.length !== 1 || matches[0].type !== 'tool_result'
        || matches[0].is_error === true) {
      throw new Error('Claude sentinel result is invalid');
    }
    const output = claudeResultText(matches[0]);
    if ((call.name === 'Read' && !output.includes('read-ok'))
        || (call.name === 'Bash' && !output.includes('child-canary-ok'))) {
      throw new Error('Claude sentinel result is invalid');
    }
  }
  return true;
}

function callResults(body) {
  return (body.input || []).filter((item) => (
    item?.type === 'custom_tool_call_output' || item?.type === 'function_call_output'
  ));
}

function createCodexHarness(fixture, owner, limits) {
  let turn = 0;
  let complete = false;
  const calls = fixture.scenario.calls;
  const blockedCalls = calls.slice(2);
  return Object.freeze({
    handle(body) {
      if (complete) throw new Error('Duplicate Codex completion');
      validateCodexEnvelope(body, fixture);
      let events;
      if (turn === 0) {
        events = codexCustomToolEvents(body.model, {
          ...calls[0], input: owner.codexExec,
        });
      } else if (turn === 1) {
        const result = callResults(body).find((item) => item.call_id === calls[0].id);
        const match = /cell ID\s+([A-Za-z0-9_-]+)/i.exec(resultText(result));
        if (!match) throw new Error('Codex exec did not yield a bounded command');
        events = codexFunctionEvents(body.model, [{
          ...calls[1],
          arguments: { cell_id: match[1], yield_time_ms: 10000, max_tokens: 10000 },
        }], 'wait');
      } else if (turn === 2) {
        const result = callResults(body).find((item) => item.call_id === calls[1].id);
        const text = resultText(result);
        if (!text.includes('wait-ok') || !text.includes('read-ok') || !text.includes('child-canary-ok')) {
          throw new Error('Codex wait result is invalid');
        }
        events = codexFunctionEvents(body.model, blockedCalls, 'blocked');
      } else if (turn === 3) {
        const results = callResults(body);
        assertCodexFailClosedResults(results, blockedCalls);
        events = codexTextEvents(body.model, fixture.scenario.finalText);
        complete = true;
      } else {
        throw new Error('Unexpected Codex turn');
      }
      turn += 1;
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' },
        body: encodeSse('codex-cli', events, limits),
      };
    },
    report() { return { complete, turns: turn, blockedToolResults: complete ? blockedCalls.length : 0 }; },
  });
}

function createClaudeHarness(fixture, owner, limits) {
  let turn = 0;
  let complete = false;
  const calls = replaceOwnerValues(fixture.scenario.calls, {
    __OWNER_READ_PATH__: owner.outsideRead,
    __OWNER_EDIT_PATH__: owner.outsideWrite,
    __OWNER_CANARY_COMMAND__: owner.canaryCommand,
  });
  return Object.freeze({
    handle(body) {
      if (complete) throw new Error('Duplicate Claude completion');
      validateClaudeEnvelope(body, fixture);
      let events;
      if (turn === 0) {
        events = claudeToolEvents(body.model, calls);
      } else if (turn === 1) {
        const results = body.messages.flatMap((message) => (
          Array.isArray(message.content) ? message.content : []
        )).filter((item) => item?.type === 'tool_result');
        assertClaudeToolResults(results, calls);
        events = claudeTextEvents(body.model, fixture.scenario.finalText);
        complete = true;
      } else {
        throw new Error('Unexpected Claude turn');
      }
      turn += 1;
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' },
        body: encodeSse('claude-code-cli', events, limits),
      };
    },
    report() { return { complete, turns: turn, blockedToolResults: 0 }; },
  });
}

function createFixedScenarioHarness({ provider, fixtures, owner, limits } = {}) {
  validateFixtureShape(provider, fixtures);
  if (!plain(owner) || !plain(limits)) throw new Error('Invalid probe owner');
  return provider === 'codex-cli'
    ? createCodexHarness(fixtures, owner, limits)
    : createClaudeHarness(fixtures, owner, limits);
}

module.exports = {
  FIXTURE_SCHEMA_VERSION,
  assertClaudeToolResults,
  assertCodexFailClosedResults,
  createFixedScenarioHarness,
  formalExecRegistry,
  sha256,
  validateCodexEnvelope,
  validateClaudeEnvelope,
  validateFixtureShape,
};
