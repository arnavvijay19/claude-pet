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
