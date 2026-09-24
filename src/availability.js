import db from './db.js';
import { endDateFor } from './calc.js';

// Two minutes by default; tests shorten it so the expiry path doesn't take two
// minutes to reach.
export const HOLD_SECONDS = Math.max(1, Number(process.env.HOLD_SECONDS) || 120);

// A held booking stops blocking the space the moment its hold lapses, so every
// availability question carries this condition rather than relying on a sweeper.
const LIVE_BOOKING = `(b.status = 'confirmed' OR (b.status = 'held' AND b.held_until > datetime('now')))`;

export function bookingsBlocking(startDate, days, { excludeId = null } = {}) {
  const endDate = endDateFor(startDate, days);
  return db.prepare(`
    SELECT b.space_id, b.id
    FROM bookings b
    WHERE ${LIVE_BOOKING}
      AND b.start_date <= ?
      AND b.end_date >= ?
      AND (? IS NULL OR b.id != ?)
  `).all(endDate, startDate, excludeId, excludeId);
}

export function isSpaceFree(spaceId, startDate, days, options = {}) {
  return !bookingsBlocking(startDate, days, options).some(b => b.space_id === Number(spaceId));
}

export function takenSpaceIds(startDate, days) {
  return new Set(bookingsBlocking(startDate, days).map(b => b.space_id));
}

export function secondsRemaining(heldUntil) {
  if (!heldUntil) return 0;
  const left = Math.ceil((Date.parse(`${heldUntil.replace(' ', 'T')}Z`) - Date.now()) / 1000);
  return Math.max(0, left);
}
