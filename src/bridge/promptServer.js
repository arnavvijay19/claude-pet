'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

const { MAX_GOAL_BYTES, validateGoal } = require('../agent/goalLimits.js');

const PORT = 47611;
const MAX_REQUEST_BYTES = MAX_GOAL_BYTES + 1024;

function send(response, status, body) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }).end(JSON.stringify(body));
}

function tokenMatches(actual, expected) {
  const left = Buffer.from(typeof actual === 'string' ? actual : '', 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function start(onPrompt, { port = PORT, token } = {}) {
  if (typeof onPrompt !== 'function') throw new TypeError('Prompt handler is required');
  if (typeof token !== 'string' || token.includes('\0')
      || Buffer.byteLength(token, 'utf8') < 32) {
    throw new TypeError('A high-entropy prompt token is required');
  }

  let server;
  server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/prompt') {
      send(response, 404, { error: 'not found' });
      return;
    }
    const address = server.address();
    const expectedHost = address && typeof address === 'object'
      ? `127.0.0.1:${address.port}`
      : null;
    if (!expectedHost || request.headers.host !== expectedHost
        || Object.hasOwn(request.headers, 'origin')) {
      send(response, 403, { error: 'forbidden' });
      return;
    }
    if (!tokenMatches(request.headers['x-claude-pet-token'], token)) {
      send(response, 401, { error: 'unauthorized' });
      return;
    }
    const contentType = String(request.headers['content-type'] || '').toLowerCase();
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
      send(response, 415, { error: 'application/json required' });
      return;
    }
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      send(response, 413, { error: 'request too large' });
      request.resume();
      return;
    }

    const chunks = [];
    let bytes = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        rejected = true;
        send(response, 413, { error: 'request too large' });
        request.removeAllListeners('data');
        request.resume();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on('error', () => {
      rejected = true;
      if (!response.headersSent) send(response, 400, { error: 'invalid request' });
    });
    request.on('end', () => {
      if (rejected) return;
      let parsed;
      try {
        const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, { error: 'invalid JSON' });
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
          || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'text')) {
        send(response, 400, { error: 'text is required' });
        return;
      }
      try {
        validateGoal(parsed.text);
      } catch {
        send(response, 400, { error: 'text is required' });
        return;
      }
      send(response, 202, { accepted: true });
      Promise.resolve().then(() => onPrompt(parsed.text)).catch(() => {});
    });
  });
  server.headersTimeout = 2000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 8;
  server.on('connection', (socket) => {
    socket.setTimeout(5000, () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, '127.0.0.1');
  });
  return server;
}

module.exports = {
  MAX_REQUEST_BYTES,
  PORT,
  start,
};
