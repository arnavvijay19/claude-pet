const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start, PORT } = require('../src/bridge/promptServer.js');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path, method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function postChunked(path, chunks) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path, method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody || '{}') }));
      },
    );
    req.on('error', reject);
    void (async () => {
      for (const chunk of chunks) {
        req.write(chunk);
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
      }
      req.end();
    })().catch(reject);
  });
}

test('accepts a prompt, notifies the window, and calls onPrompt', async () => {
  const sent = [];
  const prompts = [];
  const fakeWindow = { webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  const server = start(fakeWindow, (text) => prompts.push(text));
  try {
    const { status, body } = await post('/prompt', { text: 'hello pet' });
    assert.equal(status, 202);
    assert.deepEqual(body, { accepted: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'pet:prompt');
    assert.equal(sent[0].payload.text, 'hello pet');
    assert.deepEqual(prompts, ['hello pet']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rejects a request missing text', async () => {
  const fakeWindow = { webContents: { send: () => {} } };
  const server = start(fakeWindow, () => {});
  try {
    const { status } = await post('/prompt', {});
    assert.equal(status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rejects a null JSON body', async () => {
  const fakeWindow = { webContents: { send: () => {} } };
  const server = start(fakeWindow, () => {});
  try {
    const { status } = await post('/prompt', null);
    assert.equal(status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('preserves split multibyte UTF-8 in chunked requests', async () => {
  const sent = [];
  const prompts = [];
  const fakeWindow = { webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  const server = start(fakeWindow, (text) => prompts.push(text));
  const character = Buffer.from('é');
  try {
    const { status } = await postChunked('/prompt', [
      Buffer.from('{"text":"caf'),
      character.subarray(0, 1),
      character.subarray(1),
      Buffer.from(' pet"}'),
    ]);
    assert.equal(status, 202);
    assert.deepEqual(sent, [{ channel: 'pet:prompt', payload: { text: 'café pet' } }]);
    assert.deepEqual(prompts, ['café pet']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
