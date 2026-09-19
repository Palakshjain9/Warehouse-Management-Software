function toUTCDays(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Start day counts as day 1, so a lease starting today already owes one day's rent.
export function daysOccupied(startDate, endDate) {
  const end = endDate ?? todayStr();
  const diff = toUTCDays(end) - toUTCDays(startDate);
  return Math.max(diff, 0) + 1;
}

export function accruedRent(lease) {
  return daysOccupied(lease.start_date, lease.end_date) * lease.daily_rate;
}
