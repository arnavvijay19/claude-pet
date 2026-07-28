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
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'].includes(message.method)) {
        events.push(message);
      }
      return;
    }
    if (!pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  return {
    events,
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, expression)) return;
    await delay(100);
  }
  const diagnostic = await evaluate(cdp, `(() => ({
    status: document.querySelector('#app-status')?.textContent,
    body: document.body?.innerText?.slice(0, 2000)
  }))()`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function clickText(cdp, selector, text) {
  return evaluate(cdp, `(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((item) => item.textContent.trim() === ${JSON.stringify(text)});
    if (!node) return false;
    node.click();
    return true;
  })()`);
}

async function submitGoal(cdp, text) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector('.composer textarea');
    input.value = ${JSON.stringify(text)};
    [...document.querySelectorAll('.composer button')]
      .find((item) => item.textContent.trim() === 'Send').click();
  })()`);
}

async function waitIdle(cdp) {
  await waitFor(
    cdp,
    `(() => {
      const primary = [...document.querySelectorAll('.composer button')]
        .find((item) => ['Send', 'Stop'].includes(item.textContent.trim()));
      return primary?.textContent.trim() === 'Send';
    })()`,
    'idle composer',
  );
}

async function capture(cdp, outputDirectory, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  const layout = await evaluate(cdp, `(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    title: document.title,
    firstRunVisible: !document.querySelector('#first-run').hidden,
    bodyText: document.body.innerText.slice(0, 2000)
  }))()`);
  const image = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const file = path.join(outputDirectory, `ux-task-6-${width}x${height}.png`);
  await fs.writeFile(file, Buffer.from(image.data, 'base64'));
  return { file, ...layout };
}

async function attachThroughPet(pet, filePath) {
  await evaluate(pet, `(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'e2e-attachment';
    document.body.append(input);
  })()`);
  const documentNode = await pet.send('DOM.getDocument');
  const inputNode = await pet.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '#e2e-attachment',
  });
  await pet.send('DOM.setFileInputFiles', {
    nodeId: inputNode.nodeId,
    files: [path.resolve(filePath)],
  });
  await evaluate(pet, `window.claudePet.submitTextFile(
    document.querySelector('#e2e-attachment').files[0]
  )`);
}

async function main() {
  let stage = 'connect';
  const watchdog = setTimeout(() => {
    process.stderr.write(`e2e: watchdog at ${stage}\n`);
    process.exit(2);
  }, 90000);
  const port = Number(process.argv[2]);
  const outputDirectory = path.resolve(process.argv[3]);
  const mode = process.argv[4] || 'run';
  const attachmentPath = process.argv[5];
  const workspacePath = process.argv[6] || 'C:\\Users\\eklip\\Desktop\\a';
  if (!Number.isSafeInteger(port) || !process.argv[3]) {
    throw new Error('Usage: node capture_app_e2e.js <port> <output-directory> [run|restore] [attachment] [workspace]');
  }
  await fs.mkdir(outputDirectory, { recursive: true });
  const targets = await json(`http://127.0.0.1:${port}/json/list`);
  const appTarget = targets.find((item) => item.type === 'page' && /app[\\/]index\.html/i.test(item.url));
  const petTarget = targets.find((item) => item.type === 'page' && /renderer[\\/]index\.html/i.test(item.url));
  if (!appTarget || !petTarget) throw new Error('Claude Pet app and pet targets were not found');
  const app = await connect(appTarget.webSocketDebuggerUrl);
  const pet = await connect(petTarget.webSocketDebuggerUrl);
  const results = [];
  try {
    for (const cdp of [app, pet]) {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable');
    }
    if (mode === 'run') {
      stage = 'fresh profile';
      process.stderr.write('e2e: fresh profile\n');
      await waitFor(app, `!document.querySelector('#first-run').hidden`, 'fresh profile');
      await evaluate(app, `(() => {
        document.querySelector('#first-agent-name').value = 'Researcher';
        document.querySelector('#first-workspace').value = ${JSON.stringify(workspacePath)};
        document.querySelector('#first-goal').value = 'Summarize the workspace safely';
        document.querySelector('#first-run-form').requestSubmit();
      })()`);
      await waitFor(app, `document.querySelectorAll('.turn').length >= 2`, 'first agent response', 20000);
      stage = 'create second participant';
      process.stderr.write('e2e: first response\n');
      await clickText(app, 'button', 'Settings');
      await waitFor(app, `!document.querySelector('#settings-root').hidden`, 'settings view');
      await evaluate(app, `(() => {
        document.querySelector('[data-field="new-agent-name"]').value = 'Reviewer';
        document.querySelector('[data-action="create-agent"]').click();
      })()`);
      await waitFor(app, `document.body.innerText.includes('Add Reviewer to this session')`, 'new agent');
      await clickText(app, 'button', 'Add Reviewer to this session');
      await waitFor(app, `document.querySelectorAll('.participant-row').length === 2`, 'second participant');
      stage = 'second participant response';
      process.stderr.write('e2e: second participant\n');
      await clickText(app, 'button', 'Back to conversation');
      await waitFor(app, `!document.querySelector('#conversation-root').hidden`, 'conversation');
      await evaluate(app, `document.querySelector('[data-agent-id]:not([data-agent-id=""])') !== null`);
      await clickText(app, '.agent-item', 'Revieweridle');
      await waitFor(app, `document.querySelector('.conversation-header .eyebrow').textContent.includes('Reviewer')`, 'Reviewer selection');
      await submitGoal(app, 'Review the first result');
      await waitFor(app, `document.querySelectorAll('.turn').length >= 4`, 'second agent response', 20000);
      stage = 'stop and retry';
      process.stderr.write('e2e: second response\n');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await submitGoal(app, 'Test the Stop and Retry controls');
        await waitFor(app, `[...document.querySelectorAll('.composer button')].some((item) => item.textContent.trim() === 'Stop')`, 'Stop control');
        await clickText(app, '.composer button', 'Stop');
        await waitIdle(app);
        if (await evaluate(app, `document.querySelector('.terminal-stopped') !== null`)) break;
      }
      await waitFor(app, `document.querySelector('.terminal-stopped') !== null`, 'stopped state');
      await clickText(app, '.terminal-stopped button', 'Retry');
      await waitIdle(app);
      await waitFor(app, `document.querySelector('.terminal-success') !== null`, 'retry success', 20000);
      stage = 'controlled failure';
      process.stderr.write('e2e: stop and retry\n');

      await submitGoal(app, 'fail:COMMAND_FAILED');
      await waitFor(app, `document.querySelector('.terminal-error') !== null`, 'controlled failure', 10000);
      await submitGoal(app, 'Recover after the controlled failure');
      await waitFor(app, `document.querySelector('.terminal-success') !== null`, 'failure recovery', 20000);
      stage = 'attachment';
      process.stderr.write('e2e: failure recovery\n');

      if (!attachmentPath) throw new Error('Attachment path required for run mode');
      await attachThroughPet(pet, attachmentPath);
      await waitIdle(app);
      stage = 'pet reopen';
      process.stderr.write('e2e: attachment\n');
      await evaluate(app, 'window.close()');
      const reopened = await evaluate(pet, 'window.claudePet.openApp()');
      if (reopened !== true) throw new Error('Pet did not reopen the shared app window');
      process.stderr.write('e2e: pet reopen\n');
    } else {
      stage = 'restore';
      await waitFor(app, `document.querySelectorAll('.turn').length >= 8`, 'restored history');
      await waitFor(app, `document.body.innerText.includes('Researcher') && document.body.innerText.includes('Reviewer')`, 'restored participants');
    }
    for (const [width, height] of [[900, 650], [1440, 900]]) {
      results.push(await capture(app, outputDirectory, width, height));
    }
    const errors = [...app.events, ...pet.events].filter(
      (event) => event.method !== 'Runtime.consoleAPICalled'
        || event.params.type === 'error',
    );
    await fs.writeFile(
      path.join(outputDirectory, `ux-task-6-${mode}-console.json`),
      `${JSON.stringify(errors, null, 2)}\n`,
    );
  } finally {
    clearTimeout(watchdog);
    app.close();
    pet.close();
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
