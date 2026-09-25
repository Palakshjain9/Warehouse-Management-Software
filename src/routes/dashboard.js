import { Router } from 'express';
import db from '../db.js';
import { todayStr } from '../calc.js';
import { takenSpaceIds } from '../availability.js';

const router = Router();

router.get('/', (req, res) => {
  const stats = db.prepare(`
    SELECT COUNT(*) AS space_count, COALESCE(SUM(size_sqft), 0) AS total_sqft FROM spaces
  `).get();

  const today = todayStr();
  const bookedToday = takenSpaceIds(today, 1).size;

  // Booked and collected are different questions once the owner can record a
  // booking that hasn't been paid for yet.
  const confirmed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total,
           COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount ELSE 0 END), 0) AS collected,
           COUNT(*) AS count
    FROM bookings WHERE status = 'confirmed'
  `).get();

  const upcoming = db.prepare(`
    SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed' AND start_date > ?
  `).get(today).c;

  res.json({
    spaceCount: stats.space_count,
    totalSqft: stats.total_sqft,
    bookedToday,
    availableToday: stats.space_count - bookedToday,
    confirmedCount: confirmed.count,
    confirmedRevenue: confirmed.total,
    collected: confirmed.collected,
    outstanding: confirmed.total - confirmed.collected,
    upcoming,
  });
});

export default router;
