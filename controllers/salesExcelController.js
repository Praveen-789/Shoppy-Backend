const { parseDate } = require('./vendorSalesController');
const { buildWorkbook } = require('../services/salesExcelService');

async function download(request, response, next) {
  const { from, to } = request.query;
  const start = from === undefined ? undefined : parseDate(from);
  const end = to === undefined ? undefined : parseDate(to);
  if ((from !== undefined && !start) || (to !== undefined && !end) || (start && end && start > end)) {
    return response.status(400).json({ message: 'Use valid from/to dates in YYYY-MM-DD format, with from before or equal to to.' });
  }
  const abort = new AbortController();
  const onClose = () => { if (!response.writableFinished) abort.abort(); };
  response.once('close', onClose);
  try {
    const workbook = await buildWorkbook(request.user.id, start, end ? new Date(end.getTime() + 86400000) : undefined, abort.signal);
    const buffer = await workbook.xlsx.writeBuffer();
    if (abort.signal.aborted) return;
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="shoppy-sales.xlsx"');
    response.send(Buffer.from(buffer));
  } catch (error) {
    if (!abort.signal.aborted) {
      if (error.status === 422) response.status(422).json({ message: error.message });
      else next(error);
    }
  } finally {
    response.off('close', onClose);
  }
}
module.exports = { download };
