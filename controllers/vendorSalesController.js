const service = require('../services/vendorSalesService');
const dayMs = 24 * 60 * 60 * 1000;
const indiaOffsetMs = 330 * 60 * 1000;

function indiaDate(date) {
  return new Date(date.getTime() + indiaOffsetMs).toISOString().slice(0, 10);
}

// Dates describe whole calendar days in India, including the final day.
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const midnight = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== value) return null;
  return new Date(midnight.getTime() - 330 * 60 * 1000);
}

async function getSales(request, response, next) {
  try {
    const { from, to } = request.query;
    const start = from === undefined ? undefined : parseDate(from);
    const end = to === undefined ? undefined : parseDate(to);
    if ((from !== undefined && !start) || (to !== undefined && !end) || (start && end && start > end)) {
      return response.status(400).json({ message: 'Use valid from/to dates in YYYY-MM-DD format, with from before or equal to to.' });
    }
    const endExclusive = end ? new Date(end.getTime() + dayMs) : undefined;
    // Summary can cover all time; keep the daily chart readable and bounded.
    const today = parseDate(indiaDate(new Date()));
    const chartEnd = end || (start && start > today ? start : today);
    const last30Start = new Date(chartEnd.getTime() - 29 * dayMs);
    const chartStart = start && start > last30Start ? start : last30Start;
    const chartPeriod = {
      start: chartStart, endExclusive: new Date(chartEnd.getTime() + dayMs),
      from: indiaDate(chartStart), to: indiaDate(chartEnd),
    };
    response.json({
      period: { from: from ?? null, to: to ?? null, timezone: 'Asia/Kolkata', dateField: 'createdAt' },
      ...await service.getSales(request.user.id, start, endExclusive, chartPeriod),
    });
  } catch (error) { next(error); }
}
module.exports = { getSales };
