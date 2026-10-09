const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const createRequestLogger = require('../middleware/requestLogger');

async function test() {
  const records = [];
  const app = express();
  app.use(createRequestLogger(line => records.push(JSON.parse(line))));
  app.use(express.json());
  app.post('/example', (request, response) => response.json({ requestId: request.id }));
  app.use((error, request, response, next) => response.status(400).json({ requestId: request.id }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/example?email=secret@example.com`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'private-cookie' },
      body: JSON.stringify({ password: 'private-password' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.requestId, response.headers.get('x-request-id'));
    const bad = await fetch(`${base}/example`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
    });
    await bad.json();
    assert.equal(bad.status, 400);
    const missing = await fetch(`${base}/missing`);
    await missing.text();
    assert.equal(missing.status, 404);
    assert.equal(records.length, 3, 'Each request should be logged exactly once.');
    assert.deepEqual(records.map(record => record.status), [200, 400, 404]);
    assert.equal(records[0].requestId, data.requestId);
    assert.equal(new Set(records.map(record => record.requestId)).size, 3);
    assert.ok(records.every(record => record.completed && record.durationMs >= 0));
    assert.equal(records[0].path, '/example');
    assert.doesNotMatch(JSON.stringify(records), /secret@example|private-cookie|private-password/);
    console.log('Request logging tests passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
