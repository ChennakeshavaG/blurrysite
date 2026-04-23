'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/html');
const PORT_FILE    = path.join(__dirname, '.perf-server-port');

const MIME_TYPES = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

module.exports = async function globalSetup() {
  const server = http.createServer(function onRequest(req, res) {
    // Strip query string
    const urlPath  = req.url.split('?')[0];
    const filePath = path.join(FIXTURES_DIR, urlPath);

    // Prevent directory traversal outside FIXTURES_DIR
    if (!filePath.startsWith(FIXTURES_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden', path: urlPath }));
      return;
    }

    fs.readFile(filePath, function onRead(err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found', path: urlPath }));
        return;
      }

      const ext      = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(data);
    });
  });

  await new Promise(function (resolve, reject) {
    server.listen(0, '127.0.0.1', function () {
      resolve();
    });
    server.once('error', reject);
  });

  const port = server.address().port;

  // 1. Expose to current process environment
  process.env.PERF_FIXTURE_PORT = String(port);

  // 2. Write port to temp file for teardown (different process)
  fs.writeFileSync(PORT_FILE, String(port), 'utf8');

  // 3. Attach to global for in-process teardown
  global.__PERF_HTTP_SERVER__ = server;

  console.log('[perf] Fixture server: http://127.0.0.1:' + port);
};
