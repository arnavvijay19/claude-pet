'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

async function main() {
  const port = Number(process.argv[2]);
  const outputDirectory = path.resolve(process.argv[3]);
  if (!Number.isSafeInteger(port) || !process.argv[3]) throw new Error('Usage: node capture_app_layout.js <port> <output-directory>');
  await fs.mkdir(outputDirectory, { recursive: true });
  const targets = await json(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find((item) => item.type === 'page' && /app[\\/]index\.html/i.test(item.url));
  if (!target) throw new Error('Claude Pet application target not found');
  const cdp = await connect(target.webSocketDebuggerUrl);
  const results = [];
  try {
    await cdp.send('Page.enable');
    for (const [width, height] of [[900, 650], [1440, 900]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      });
      const layout = await cdp.send('Runtime.evaluate', {
        expression: `(() => ({
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          title: document.title,
          firstRunVisible: !document.querySelector('#first-run').hidden,
          bodyText: document.body.innerText.slice(0, 1000)
        }))()`,
        returnByValue: true,
      });
      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const file = path.join(outputDirectory, `ux-task-4-${width}x${height}.png`);
      await fs.writeFile(file, Buffer.from(capture.data, 'base64'));
      results.push({ file, ...layout.result.value });
    }
  } finally {
    cdp.close();
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
