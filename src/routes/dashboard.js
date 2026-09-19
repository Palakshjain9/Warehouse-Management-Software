import { Router } from 'express';
import db from '../db.js';
import { accruedRent } from '../calc.js';

const router = Router();

router.get('/', (req, res) => {
  const zoneStats = db.prepare(`
    SELECT
      COUNT(*) AS zone_count,
      COALESCE(SUM(size_sqft), 0) AS total_sqft
    FROM zones
  `).get();

  const occupied = db.prepare(`
    SELECT COUNT(DISTINCT zone_id) AS c FROM leases WHERE end_date IS NULL
  `).get().c;

  const activeLeases = db.prepare('SELECT * FROM leases WHERE end_date IS NULL').all();
  const dailyRevenue = activeLeases.reduce((sum, l) => sum + l.daily_rate, 0);

  const allLeases = db.prepare('SELECT * FROM leases').all();
  const paid = new Map(
    db.prepare('SELECT lease_id, SUM(amount) AS total FROM payments GROUP BY lease_id').all()
      .map(r => [r.lease_id, r.total])
  );
  const outstanding = allLeases.reduce((sum, l) => {
    const balance = accruedRent(l) - (paid.get(l.id) || 0);
    return sum + Math.max(balance, 0);
  }, 0);

  res.json({
    zoneCount: zoneStats.zone_count,
    totalSqft: zoneStats.total_sqft,
    occupied,
    vacant: zoneStats.zone_count - occupied,
    dailyRevenue,
    outstanding,
  });
});

export default router;
