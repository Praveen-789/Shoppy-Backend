// Lesson 1: a fixed, tiny CSV. Real sales and backpressure come next.
function downloadDemo(request, response) {
  // Headers describe the response; set them before the first write.
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', 'attachment; filename="shoppy-demo-sales.csv"');

  // Each write adds text to the outgoing HTTP response (a writable stream).
  // CRLF is the usual CSV row ending. These fixed values need no CSV escaping.
  response.write('Product,Quantity,Unit price INR\r\n');
  response.write('Blue shirt,2,499.00\r\n');
  response.write('Running shoes,1,1499.00\r\n');
  response.write('Coffee mug,3,249.00\r\n');

  // Tell Node there is no more data to send.
  response.end();
}

const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const service = require('../services/salesCsvService');
const { parseDate } = require('./vendorSalesController');

async function downloadSales(request, response, next) {
  const { from, to } = request.query;
  const start = from === undefined ? undefined : parseDate(from);
  const end = to === undefined ? undefined : parseDate(to);
  if ((from !== undefined && !start) || (to !== undefined && !end) || (start && end && start > end)) {
    return response.status(400).json({ message: 'Use valid from/to dates in YYYY-MM-DD format, with from before or equal to to.' });
  }
  let cursor;
  let closePromise;
  const abort = new AbortController();
  // Make cleanup idempotent: disconnect and finally can both request it.
  function closeCursor() {
    if (!cursor) return Promise.resolve();
    if (!closePromise) closePromise = cursor.close().catch(() => {
      console.error('Sales export cursor cleanup failed.');
    });
    return closePromise;
  }
  function onClose() {
    if (!response.writableFinished) {
      abort.abort();
      void closeCursor();
    }
  }
  response.once('close', onClose);
  try {
    cursor = service.createCursor(request.user.id, start, end ? new Date(end.getTime() + 86400000) : undefined);
    // Check the database before sending headers, so initial failures can be JSON.
    const firstOrder = await cursor.next();
    if (abort.signal.aborted) return;
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="shoppy-sales.csv"');
    // pipeline handles write(false)/drain backpressure and stream errors for us.
    await pipeline(
      Readable.from(service.generateCsv(cursor, firstOrder, request.user.id), { objectMode: false }),
      response,
      { signal: abort.signal },
    );
  } catch (error) {
    if (!abort.signal.aborted) {
      if (!response.headersSent && !response.destroyed) {
        response.removeHeader('Content-Disposition');
        response.removeHeader('Content-Type');
      }
      next(error);
    }
  } finally {
    response.off('close', onClose);
    await closeCursor();
  }
}

module.exports = { downloadDemo, downloadSales };
