const fs = require('node:fs/promises');
const path = require('node:path');

// One writer per Node process. Awaited writes stay ordered without blocking HTTP.
function createLogWriter({
  directory = path.join(__dirname, '..', 'logs'),
  maxBytes = 5 * 1024 * 1024,
  now = () => new Date(),
  consoleWrite = line => console.log(line),
  reportError = () => console.error('File logging failed; terminal logging is still available.'),
} = {}) {
  let queue = Promise.resolve();
  let pendingBytes = 0;
  let activeDay;
  let warned = false;

  async function save(line, day) {
    await fs.mkdir(directory, { recursive: true });
    if (activeDay !== day) {
      // Keep today and the preceding six calendar days (UTC filenames).
      const cutoff = new Date(`${day}T00:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - 6);
      const oldest = cutoff.toISOString().slice(0, 10);
      for (const name of await fs.readdir(directory)) {
        if (/^shoppy-\d{4}-\d{2}-\d{2}\.log(?:\.[123])?$/.test(name) && name.slice(7, 17) < oldest) {
          await fs.unlink(path.join(directory, name));
        }
      }
      activeDay = day;
    }
    const file = path.join(directory, `shoppy-${day}.log`);
    let size = 0;
    try { size = (await fs.stat(file)).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entry = `${line}\n`;
    if (size && size + Buffer.byteLength(entry) > maxBytes) {
      // Three backups plus the active file per day.
      await fs.rm(`${file}.3`, { force: true });
      for (let index = 2; index >= 0; index--) {
        const source = index ? `${file}.${index}` : file;
        try { await fs.rename(source, `${file}.${index + 1}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    await fs.appendFile(file, entry, 'utf8');
  }

  function write(line) {
    consoleWrite(line);
    const bytes = Buffer.byteLength(line) + 1;
    // Bound the queue if disk writes cannot keep up. Terminal logs still work.
    if (bytes > maxBytes || pendingBytes + bytes > 1024 * 1024) {
      if (!warned) { reportError(); warned = true; }
      return;
    }
    const day = now().toISOString().slice(0, 10);
    pendingBytes += bytes;
    queue = queue.then(() => save(line, day)).catch(() => {
      if (!warned) { reportError(); warned = true; }
    }).finally(() => { pendingBytes -= bytes; });
  }

  return { write, flush: () => queue };
}

module.exports = createLogWriter;
