const http = require('node:http');

const PORT = 47611;

async function start(onPrompt, { port = PORT } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/prompt') {
      res.writeHead(404).end();
      return;
    }
    req.setEncoding('utf8');
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
      if (parsed === null || typeof parsed !== 'object' || typeof parsed.text !== 'string' || parsed.text.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true }));
      Promise.resolve().then(() => onPrompt(parsed.text)).catch(() => {});
    });
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

module.exports = { start, PORT };
