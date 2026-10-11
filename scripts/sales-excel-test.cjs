const assert = require('node:assert/strict');
const { once } = require('node:events');
const ExcelJS = require('exceljs');
const express = require('express');
const cookieParser = require('cookie-parser');
const csvService = require('../services/salesCsvService');
const auth = require('../services/authService');
const originalCursor = csvService.createCursor;
const originalAuth = auth.getUserFromToken;
let mode = 'normal';
let dates;
let closed = 0;
csvService.createCursor = (id, start, end) => {
  assert.equal(id, 'vendor'); dates = [start, end];
  return {
    async *[Symbol.asyncIterator]() {
      if (mode === 'failure') throw new Error('Database failed');
      if (mode === 'empty') return;
      const item = { vendor: 'vendor', name: 'A long product name with commas, quotes "blue" and\nmultiple lines', quantity: 2, unitPricePaise: 12550 };
      yield {
        _id: '012345678901234567890123', createdAt: new Date('2026-10-01T00:00:00Z'),
        vendorOrders: [{ vendor: 'vendor', status: 'packed', paymentStatus: 'pending' }],
        items: mode === 'limit' ? Array.from({ length: 10001 }, () => item) : [
          item, { ...item, name: '=SUM(A1:A2)' }, { ...item, vendor: 'other', name: 'PRIVATE' },
        ],
      };
    },
    async close() { closed++; },
  };
};
auth.getUserFromToken = async token => token === 'vendor' ? { id: 'vendor', role: 'vendor' }
  : token === 'buyer' ? { id: 'buyer', role: 'user' } : null;

async function test() {
  const app = express(); app.use(cookieParser());
  app.use('/api/vendor', require('../routes/vendor'));
  app.use((error, request, response, next) => response.status(500).json({ message: 'Export failed.' }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/vendor/sales/export.xlsx`;
    const headers = { Cookie: 'authToken=vendor' };
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Cookie: 'authToken=buyer' } })).status, 403);
    assert.equal((await fetch(url + '?from=2026-02-30', { headers })).status, 400);
    const response = await fetch(url + '?from=2026-10-01&to=2026-10-01', { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);
    assert.match(response.headers.get('content-disposition'), /shoppy-sales.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = workbook.getWorksheet('Sales');
    assert.equal(sheet.rowCount, 3);
    assert.equal(sheet.getCell('A2').value, '012345678901234567890123');
    assert.ok(sheet.getCell('B2').value instanceof Date);
    assert.equal(sheet.getCell('E2').value, 125.5);
    assert.equal(sheet.getCell('F2').value, 251);
    assert.match(sheet.getCell('E2').numFmt, /₹/);
    assert.equal(sheet.getCell('C3').value, '=SUM(A1:A2)');
    assert.equal(sheet.getCell('C3').type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell('A1').font.bold, true);
    assert.equal(sheet.getCell('C2').alignment.wrapText, true);
    assert.equal(sheet.getColumn(3).width, 40);
    assert.ok(sheet.getRow(2).height > 32);
    assert.equal(sheet.views[0].ySplit, 1);
    assert.ok(sheet.autoFilter);
    assert.equal(dates[0].toISOString(), '2026-09-30T18:30:00.000Z');
    assert.equal(dates[1].toISOString(), '2026-10-01T18:30:00.000Z');
    mode = 'empty';
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load(Buffer.from(await (await fetch(url, { headers })).arrayBuffer()));
    assert.equal(empty.getWorksheet('Sales').rowCount, 1);
    mode = 'limit'; assert.equal((await fetch(url, { headers })).status, 422);
    mode = 'failure'; assert.equal((await fetch(url, { headers })).status, 500);
    assert.equal(closed, 4);
    console.log('Excel export tests passed: styles, types, isolation, roles, dates, limits, empty exports and cleanup.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    csvService.createCursor = originalCursor;
    auth.getUserFromToken = originalAuth;
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
