'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start } = require('../src/bridge/promptServer.js');

const TOKEN = 'a'.repeat(32);

function waitFor(server, event) {
  return new Promise((resolve, reject) => {
    server.once(event, resolve);
    server.once('error', reject);
  });
}

async function startServer(onPrompt) {
  return start(onPrompt, { port: 0, token: TOKEN });
}

function post(server, path, body, overrides = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const port = server.address().port;
    const request = http.request({
      hostname: '127.0.0.1', port, path, method: overrides.method || 'POST', agent: false,
      headers: {
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-Claude-Pet-Token': TOKEN,
        ...(overrides.headers || {}),
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text || '{}') }));
    });
    request.on('error', reject);
    request.end(data);
  });
}

function postChunked(server, chunks) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port: server.address().port, path: '/prompt', method: 'POST', agent: false,
      headers: {
        Host: `127.0.0.1:${server.address().port}`,
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
        'X-Claude-Pet-Token': TOKEN,
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text || '{}') }));
    });
    request.on('error', reject);
    void (async () => {
      for (const chunk of chunks) {
        request.write(chunk);
        await new Promise((next) => setImmediate(next));
      }
      request.end();
    })().catch(reject);
  });
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('returns 202 immediately and isolates an asynchronous prompt-controller failure', async () => {
  const prompts = [];
  const server = await startServer(async (text) => { prompts.push(text); throw new Error('ignored'); });
  try {
    assert.deepEqual(await post(server, '/prompt', { text: 'hello pet' }), { status: 202, body: { accepted: true } });
    await new Promise((next) => setImmediate(next));
    assert.deepEqual(prompts, ['hello pet']);
  } finally {
    await close(server);
  }
});

test('preserves Task 5 request validation', async () => {
  const server = await startServer(() => {});
  try {
    assert.equal((await post(server, '/wrong', { text: 'hello' })).status, 404);
    assert.equal((await post(server, '/prompt', {})).status, 400);
    assert.equal((await post(server, '/prompt', null)).status, 400);
  } finally {
    await close(server);
  }
});

test('rejects unauthenticated browser-shaped or wrongly typed requests', async () => {
  const server = await startServer(() => {});
  try {
    assert.equal((await post(server, '/prompt', { text: 'hello' }, {
      headers: { 'X-Claude-Pet-Token': 'wrong'.repeat(8) },
    })).status, 401);
    assert.equal((await post(server, '/prompt', { text: 'hello' }, {
      headers: { Host: 'localhost:9999' },
    })).status, 403);
    assert.equal((await post(server, '/prompt', { text: 'hello' }, {
      headers: { Origin: 'http://example.com' },
    })).status, 403);
    assert.equal((await post(server, '/prompt', { text: 'hello' }, {
      headers: { 'Content-Type': 'text/plain' },
    })).status, 415);
  } finally {
    await close(server);
  }
});

test('bounds request bytes and configures short socket lifetimes', async () => {
  const server = await startServer(() => {});
  try {
    const response = await post(server, '/prompt', { text: 'x'.repeat(10000) });
    assert.equal(response.status, 413);
    assert.equal(server.headersTimeout, 2000);
    assert.equal(server.requestTimeout, 5000);
    assert.equal(server.keepAliveTimeout, 1000);
    assert.equal(server.maxRequestsPerSocket, 8);
  } finally {
    await close(server);
  }
});

test('preserves split multi-byte UTF-8 text', async () => {
  const prompts = [];
  const server = await startServer((text) => prompts.push(text));
  const character = Buffer.from('é');
  try {
    assert.equal((await postChunked(server, [Buffer.from('{"text":"caf'), character.subarray(0, 1), character.subarray(1), Buffer.from(' pet"}')])).status, 202);
    await new Promise((next) => setImmediate(next));
    assert.deepEqual(prompts, ['café pet']);
  } finally {
    await close(server);
  }
});

test('reports an occupied prompt port to its caller instead of crashing the process', async () => {
  const occupied = http.createServer();
  occupied.listen(0, '127.0.0.1');
  await waitFor(occupied, 'listening');
  try {
    const startup = start(() => {}, { port: occupied.address().port, token: TOKEN });
    if (typeof startup?.then !== 'function') {
      await new Promise((resolve) => startup.once('error', resolve));
      assert.fail('prompt-server startup must return a promise that reports listen errors');
    }
    await assert.rejects(
      startup,
      (error) => error?.code === 'EADDRINUSE',
    );
  } finally {
    await close(occupied);
  }
});

test('requires a high-entropy launch token before listening', async () => {
  const expectRejected = (options) => assert.rejects(
    start(() => {}, options).then(async (server) => {
      await close(server);
      return server;
    }),
    /token/i,
  );
  await expectRejected({ port: 0 });
  await expectRejected({ port: 0, token: 'short' });
});
