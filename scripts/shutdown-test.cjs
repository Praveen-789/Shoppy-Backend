const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const installShutdown = require('../services/gracefulShutdown');

async function test() {
  const processRef = new EventEmitter();
  processRef.exit = () => assert.fail('Normal shutdown must not force exit');
  let finishRequest;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const events = [];
  const server = http.createServer((request, response) => {
    finishRequest = () => { events.push('response'); response.end('Order finished'); };
    markStarted();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const response = new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}`, { agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  try {
    await started;
    const shutdown = installShutdown({ server, processRef,
      disconnect: async () => { events.push('database'); },
      flushLogs: async () => { events.push('logs'); },
    });
    processRef.emit('SIGINT');
    const closing = shutdown('repeat');
    assert.equal(shutdown('repeat again'), closing);
    processRef.emit('SIGTERM');
    assert.deepEqual(events, []);
    assert.equal(server.listening, false);
    await assert.rejects(new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}`, { agent: false }, res => { res.resume(); resolve(); }).on('error', reject);
    }), { code: 'ECONNREFUSED' });
    finishRequest();
    assert.equal(await response, 'Order finished');
    await closing;
    assert.deepEqual(events, ['response', 'database', 'logs']);
    assert.equal(processRef.exitCode, 0);
    assert.equal(processRef.listenerCount('SIGINT'), 0);
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }

  // A deadline must cover HTTP draining, database disconnect and log flushing.
  for (const stuckAt of ['http', 'database', 'logs']) {
    const fakeProcess = new EventEmitter();
    let forced;
    const exited = new Promise(resolve => { forced = resolve; });
    fakeProcess.exit = forced;
    let closed = false;
    let forcedConnections = false;
    const fakeServer = {
      close: callback => { closed = true; if (stuckAt !== 'http') callback(); },
      closeAllConnections: () => { forcedConnections = true; },
    };
    const never = () => new Promise(() => {});
    const shutdown = installShutdown({ server: fakeServer, processRef: fakeProcess, timeoutMs: 25,
      disconnect: stuckAt === 'database' ? never : async () => {},
      flushLogs: stuckAt === 'logs' ? never : async () => {},
    });
    void shutdown('test timeout');
    assert.equal(await exited, 1);
    assert.ok(closed && forcedConnections);
  }
  const failedProcess = new EventEmitter();
  let exitCode;
  failedProcess.exit = code => { exitCode = code; };
  const shutdown = installShutdown({
    server: { close: callback => callback(), closeAllConnections: () => {} },
    processRef: failedProcess,
    disconnect: async () => { throw new Error('Database close failed'); },
    flushLogs: async () => assert.fail('Do not report successful cleanup after failure'),
  });
  await shutdown('cleanup error');
  assert.equal(exitCode, 1);
  console.log('PASS: active response drains before MongoDB/log cleanup, new connections refused, repeated signals, timeouts and cleanup errors');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
