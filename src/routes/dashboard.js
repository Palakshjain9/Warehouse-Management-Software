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

  const confirmed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
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
    upcoming,
  });
});

export default router;
