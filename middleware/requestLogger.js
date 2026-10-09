const { randomUUID } = require('node:crypto');

// Injecting the writer makes logging testable without replacing console globally.
function createRequestLogger(write = line => console.log(line)) {
  return (request, response, next) => {
    request.id = randomUUID();
    response.setHeader('X-Request-Id', request.id);
    const started = process.hrtime.bigint();
    let logged = false;

    function log(completed) {
      if (logged) return;
      logged = true;
      write(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'http_request',
        requestId: request.id,
        method: request.method,
        // Query strings, cookies and bodies may contain private information.
        path: request.originalUrl.split('?')[0],
        status: completed ? response.statusCode : null,
        durationMs: Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(2)),
        completed,
      }));
    }

    response.once('finish', () => log(true));
    response.once('close', () => log(response.writableFinished));
    next();
  };
}

module.exports = createRequestLogger;
