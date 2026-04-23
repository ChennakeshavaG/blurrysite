'use strict';

const fs   = require('fs');
const path = require('path');

const PORT_FILE = path.join(__dirname, '.perf-server-port');

module.exports = async function globalTeardown() {
  // Close the in-process server if available
  if (global.__PERF_HTTP_SERVER__) {
    await new Promise(function (resolve) {
      global.__PERF_HTTP_SERVER__.close(resolve);
    });
    global.__PERF_HTTP_SERVER__ = undefined;
  }

  // Remove the temp port file; ignore ENOENT (already gone or never written)
  try {
    fs.unlinkSync(PORT_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  console.log('[perf] Fixture server stopped');
};
