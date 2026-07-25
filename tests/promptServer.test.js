'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start } = require('../src/bridge/promptServer.js');

function waitFor(server, event) {
  return new Promise((resolve, reject) => {
    server.once(event, resolve);
    server.once('error', reject);
  });
}

async function startServer(onPrompt) {
  const server = start(onPrompt, { port: 0 });
  await waitFor(server, 'listening');
  return server;
}

function post(server, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1', port: server.address().port, path, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
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
