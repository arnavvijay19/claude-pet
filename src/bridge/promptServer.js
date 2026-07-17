const http = require('node:http');

const PORT = 47611;

function start(petWindow, onPrompt) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/prompt') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }
      if (typeof parsed.text !== 'string' || parsed.text.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      petWindow.webContents.send('pet:prompt', { text: parsed.text });
      onPrompt(parsed.text);
      res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true }));
    });
  });
  server.listen(PORT, '127.0.0.1');
  return server;
}

module.exports = { start, PORT };
