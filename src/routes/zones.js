import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const zones = db.prepare(`
    SELECT
      z.id, z.name, z.size_sqft, z.notes,
      l.id AS active_lease_id, l.daily_rate AS active_rate, l.start_date AS active_start,
      v.id AS vendor_id, v.name AS vendor_name
    FROM zones z
    LEFT JOIN leases l ON l.zone_id = z.id AND l.end_date IS NULL
    LEFT JOIN vendors v ON v.id = l.vendor_id
    ORDER BY z.name COLLATE NOCASE
  `).all();
  res.json(zones);
});

router.post('/', (req, res) => {
  const { name, size_sqft, notes } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const info = db.prepare('INSERT INTO zones (name, size_sqft, notes) VALUES (?, ?, ?)')
      .run(String(name).trim(), size_sqft ? Number(size_sqft) : null, notes || null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'A zone with that name already exists' });
    }
    throw e;
  }
});

export default router;
