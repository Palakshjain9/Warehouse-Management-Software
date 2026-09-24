export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function daysAgoStr(n) {
  return addDays(todayStr(), -n);
}

// A booking runs from start_date to end_date inclusive, so a one-day booking
// starts and ends on the same date.
export function endDateFor(startDate, days) {
  return addDays(startDate, Math.max(1, Math.floor(Number(days) || 1)) - 1);
}

// Both ranges are inclusive on each end.
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}
