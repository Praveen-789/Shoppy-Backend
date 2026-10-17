const ExcelJS = require('exceljs');
const csvService = require('./salesCsvService');
const maxRows = 10000;

async function buildWorkbook(vendorId, start, endExclusive, signal) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shoppy';
  const sheet = workbook.addWorksheet('Sales', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    ['Order ID', 29], ['Placed at UTC', 23], ['Product', 40], ['Quantity', 12],
    ['Unit price INR', 20], ['Line total INR', 20], ['Vendor delivery status', 24], ['Vendor COD status', 20],
  ].map(([header, width]) => ({ header, width }));
  const header = sheet.getRow(1);
  header.height = 34;
  header.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF234E42' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  
  const cursor = csvService.createCursor(vendorId, start, endExclusive);
  let closePromise;
  const close = () => closePromise ||= cursor.close();
  const cancel = () => { void close().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let count = 0;
  try {
    signal.throwIfAborted();
    for await (const order of cursor) {
      signal.throwIfAborted();
      const portion = order.vendorOrders.find(part => String(part.vendor) === String(vendorId));
      if (!portion || portion.status === 'cancelled') continue;
      for (const item of order.items) {
        if (String(item.vendor) !== String(vendorId) || item.status === 'cancelled') continue;
        if (++count > maxRows) {
          const error = new Error('Excel exports support up to 10,000 product rows. Narrow the dates or use CSV.');
          error.status = 422;
          throw error;
        }
        const row = sheet.addRow([
          String(order._id), new Date(order.createdAt), String(item.name), item.quantity,
          item.unitPricePaise / 100, item.quantity * item.unitPricePaise / 100,
          portion.status, portion.paymentStatus,
        ]);
        const lines = String(item.name).split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 35)), 0);
        row.height = Math.min(409, Math.max(32, lines * 16 + 10));
        row.eachCell(cell => {
          cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF24342D' } };
          cell.alignment = { vertical: 'middle', wrapText: true };
          if (count % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5F2' } };
        });
        row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
        row.getCell(4).numFmt = '#,##0';
        for (const column of [5, 6]) row.getCell(column).numFmt = '"₹" #,##0.00';
        // Strings stay text, even if a product name starts with '='.
      }
    }
    sheet.autoFilter = { from: 'A1', to: `H${sheet.rowCount}` };
    signal.throwIfAborted();
    return workbook;
  } finally {
    signal.removeEventListener('abort', cancel);
    await close();
  }
}
module.exports = { buildWorkbook, maxRows };
