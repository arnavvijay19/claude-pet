'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const next = ++id;
      socket.send(JSON.stringify({ id: next, method, params }));
      return new Promise((resolve, reject) => pending.set(next, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, expression, label, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const [portText, outputDirectory, mode = 'inspect'] = process.argv.slice(2);
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || !outputDirectory) {
    throw new Error('Usage: node capture_codex_setup_e2e.js <port> <output-directory> [inspect|save|test|setup]');
  }
  const targets = await json(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find((item) => item.type === 'page' && /app[\\/]index\.html/i.test(item.url));
  if (!target) throw new Error('Claude Pet app target was not found');
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable');
    await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Settings').click())()`);
    await waitFor(cdp, `document.querySelector('[data-field="codex-workspace"]') !== null`, 'Codex editor');
    if (mode === 'save') {
      await evaluate(cdp, `(() => {
        document.querySelector('[data-field="codex-workspace"]').value = 'Z:\\\\Downloads\\\\Code\\\\Claude Pet';
        document.querySelector('[data-field="codex-model"]').value = 'gpt-5.6-terra';
        document.querySelector('[data-field="codex-effort"]').value = 'medium';
        document.querySelector('[data-action="save-codex-connection"]').click();
      })()`);
      await waitFor(cdp, `document.body.innerText.includes('Codex connection saved') || document.body.innerText.includes('Full Computer was not enabled')`, 'save result');
    }
    if (mode === 'test') {
      await evaluate(cdp, `(() => document.querySelector('[data-action="test-codex-connection"]').click())()`);
      await waitFor(cdp, `document.body.innerText.includes('Codex is installed') || document.body.innerText.includes('agent command is not installed')`, 'Codex test result');
    }
    if (mode === 'setup') {
      await evaluate(cdp, `(() => document.querySelector('[data-action="begin-codex-setup"]').click())()`);
      await waitFor(cdp, `document.body.innerText.includes('Official Codex sign-in opened')`, 'official sign-in launch');
    }
    const result = await evaluate(cdp, `(() => ({
      text: document.body.innerText,
      workspace: document.querySelector('[data-field="codex-workspace"]')?.value || null,
      model: document.querySelector('[data-field="codex-model"]')?.value || null,
      effort: document.querySelector('[data-field="codex-effort"]')?.value || null,
      controls: [...document.querySelectorAll('button')].map((item) => item.textContent.trim()),
    }))()`);
    await fs.mkdir(path.resolve(outputDirectory), { recursive: true });
    await fs.writeFile(path.join(outputDirectory, `codex-setup-${mode}.json`), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
