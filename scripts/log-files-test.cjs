const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const createLogWriter = require('../services/logWriter');

async function test() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shoppy-log-test-'));
  try {
    const terminal = [];
    let date = new Date('2026-10-09T12:00:00Z');
    const logger = createLogWriter({ directory, maxBytes: 80, now: () => date, consoleWrite: line => terminal.push(line) });
    await fs.writeFile(path.join(directory, 'shoppy-2026-10-01.log'), 'old');
    await fs.writeFile(path.join(directory, 'keep.txt'), 'unrelated');
    logger.write('{"event":"first"}');
    logger.write('{"event":"second"}');
    await logger.flush();
    const file = path.join(directory, 'shoppy-2026-10-09.log');
    assert.equal(await fs.readFile(file, 'utf8'), '{"event":"first"}\n{"event":"second"}\n');
    assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'unrelated');
    await assert.rejects(fs.stat(path.join(directory, 'shoppy-2026-10-01.log')), { code: 'ENOENT' });
    for (let index = 0; index < 20; index++) logger.write(JSON.stringify({ index, text: 'rotation' }));
    await logger.flush();
    const files = (await fs.readdir(directory)).filter(name => name.startsWith('shoppy-'));
    assert.equal(files.length, 4);
    for (const name of files) assert.ok((await fs.stat(path.join(directory, name))).size <= 80);
    assert.match(await fs.readFile(file, 'utf8'), /"index":19/);
    date = new Date('2026-10-10T00:00:00Z');
    logger.write('{"event":"new-day"}');
    await logger.flush();
    assert.match(await fs.readFile(path.join(directory, 'shoppy-2026-10-10.log'), 'utf8'), /new-day/);
    assert.equal(terminal.length, 23);
    let warnings = 0;
    const broken = createLogWriter({ directory: path.join(directory, 'keep.txt', 'logs'), consoleWrite: () => {}, reportError: () => warnings++ });
    broken.write('first'); broken.write('second');
    await broken.flush();
    assert.equal(warnings, 1, 'Disk failures must not reject the queue or spam warnings.');
    console.log('Log file tests passed: ordering, rotation, retention, day changes and disk failures.');
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('shoppy-log-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
