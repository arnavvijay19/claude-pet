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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
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
    throw new Error('Usage: node capture_codex_setup_e2e.js <port> <output-directory> [inspect|save|edit|test|setup|activity|live-smoke|live-verify|live-retry]');
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
        document.querySelector('[data-field="codex-workspace"]').value = 'C:\\\\Users\\\\eklip\\\\Desktop\\\\a';
        document.querySelector('[data-field="codex-model"]').value = 'gpt-5.6-terra';
        document.querySelector('[data-field="codex-effort"]').value = 'medium';
        document.querySelector('[data-action="save-codex-connection"]').click();
      })()`);
      await waitFor(cdp, `document.body.innerText.includes('Codex connection saved') || document.body.innerText.includes('Full Computer was not enabled')`, 'save result');
    }
    if (mode === 'edit') {
      await evaluate(cdp, `(() => {
        document.querySelector('[data-action="edit-codex-connection"]').click();
        document.querySelector('[data-field="codex-workspace"]').value = 'C:\\\\Users\\\\eklip\\\\Desktop\\\\a';
        document.querySelector('[data-action="save-codex-connection"]').click();
      })()`);
      await waitFor(cdp, `document.body.innerText.includes('Codex connection saved') || document.body.innerText.includes('Full Computer was not enabled')`, 'edit result');
    }
    if (mode === 'test') {
      await evaluate(cdp, `(() => document.querySelector('[data-action="test-codex-connection"]').click())()`);
      await waitFor(cdp, `document.body.innerText.includes('Codex is installed') || document.body.innerText.includes('agent command is not installed')`, 'Codex test result');
    }
    if (mode === 'setup') {
      await evaluate(cdp, `(() => document.querySelector('[data-action="begin-codex-setup"]').click())()`);
      await waitFor(cdp, `document.body.innerText.includes('Official Codex sign-in opened')`, 'official sign-in launch');
    }
    if (mode === 'activity') {
      await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Back to conversation').click())()`);
      await waitFor(cdp, `!document.querySelector('#conversation-root').hidden`, 'conversation view');
      await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Activity').click())()`);
      await waitFor(cdp, `!document.querySelector('#activity-root').hidden`, 'activity view');
    }
    if (mode === 'live-smoke' || mode === 'live-verify') {
      await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Back to conversation').click())()`);
      await waitFor(cdp, `!document.querySelector('#conversation-root').hidden`, 'conversation view');
      await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'New session').click())()`);
      await waitFor(cdp, `(() => { const form = document.querySelector('.inline-session-form'); return form && !form.hidden; })()`, 'new session form');
      await evaluate(cdp, `(() => {
        const form = document.querySelector('.inline-session-form');
        const connection = form.querySelector('select[name="connection"]');
        const codex = [...connection.options].find((item) => item.textContent.trim().startsWith('Codex'));
        if (!codex) throw new Error('Codex connection was not offered for the new session: ' + [...connection.options].map((item) => item.textContent.trim()).join(' | '));
        form.querySelector('input[name="title"]').value = ${JSON.stringify(mode === 'live-verify' ? 'Codex live verify' : 'Codex live smoke')};
        connection.value = codex.value;
        form.requestSubmit();
      })()`);
      await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(mode === 'live-verify' ? 'Codex live verify' : 'Codex live smoke')}) && document.body.innerText.includes('C:\\\\Users\\\\eklip\\\\Desktop\\\\a')`, 'selected Codex session');
      const beforeTurns = await evaluate(cdp, `document.querySelectorAll('.turn').length`);
      await evaluate(cdp, `(() => {
        const composer = document.querySelector('.composer');
        composer.querySelector('textarea').value = ${JSON.stringify(mode === 'live-verify'
          ? 'Read only the file claude-pet-live-smoke.txt in the current project folder. Report its exact path and whether its content is exactly one line: Claude Pet live smoke test. Do not modify any files.'
          : 'Create exactly one new UTF-8 file named claude-pet-live-smoke.txt in the current project folder. Its only content must be Claude Pet live smoke test. followed by one newline. Do not read or modify any other files. Then state the file path.')};
        [...composer.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Send').click();
      })()`);
      await waitFor(cdp, `(() => document.querySelectorAll('.turn').length >= ${beforeTurns + 2} || document.querySelector('.terminal-error'))()`, 'live Codex result', 180000);
      const terminalError = await evaluate(cdp, `document.querySelector('.terminal-error')?.innerText || null`);
      if (terminalError) throw new Error(terminalError);
    }
    if (mode === 'live-retry') {
      await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Back to conversation').click())()`);
      await waitFor(cdp, `!document.querySelector('#conversation-root').hidden`, 'conversation view');
      await waitFor(cdp, `Boolean([...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Retry'))`, 'Retry control');
      const beforeTurns = await evaluate(cdp, `document.querySelectorAll('.turn').length`);
      await evaluate(cdp, `(() => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Retry').click())()`);
      await waitFor(cdp, `(() => document.querySelectorAll('.turn').length >= ${beforeTurns + 1} || document.querySelector('.terminal-error'))()`, 'retried Codex result', 180000);
      const terminalError = await evaluate(cdp, `document.querySelector('.terminal-error')?.innerText || null`);
      if (terminalError) throw new Error(terminalError);
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
