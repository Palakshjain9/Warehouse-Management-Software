import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Deliberately narrow: a customer sees what a space is and whether it is free, never
// who is in it, what they pay, or anything else about the other tenants.
router.get('/spaces', (req, res) => {
  const rows = db.prepare(`
    SELECT
      z.id, z.name, z.size_sqft, z.length_ft, z.width_ft, z.height_ft, z.wall_support,
      z.list_rate_per_day, z.hot_x, z.hot_y, z.hot_w, z.hot_h,
      (l.id IS NOT NULL) AS taken
    FROM zones z
    LEFT JOIN leases l ON l.zone_id = z.id AND l.end_date IS NULL
    WHERE z.hot_w IS NOT NULL
    ORDER BY z.name COLLATE NOCASE
  `).all();
  res.json(rows.map(r => ({ ...r, taken: !!r.taken })));
});

router.get('/plan-image', (req, res) => {
  const row = db.prepare('SELECT data_url FROM plan_image WHERE id = 1').get();
  res.json(row ?? { data_url: null });
});

router.post('/bookings', (req, res) => {
  const b = req.body ?? {};
  const zone = db.prepare('SELECT id, name FROM zones WHERE id = ?').get(b.zone_id);
  if (!zone) return res.status(400).json({ error: 'Pick a space first' });

  if (!b.customer_name || !String(b.customer_name).trim()) {
    return res.status(400).json({ error: 'Please give us a name to put on the booking' });
  }

  const taken = db.prepare('SELECT id FROM leases WHERE zone_id = ? AND end_date IS NULL').get(zone.id);
  if (taken) return res.status(409).json({ error: 'Sorry — that space was taken just now. Please pick another.' });

  const num = v => (v === '' || v === undefined || v === null ? null : Number(v));
  const info = db.prepare(`
    INSERT INTO bookings
      (zone_id, customer_name, contact, quantity, item_label, item_l_ft, item_w_ft, item_h_ft,
       start_date, estimated_capacity, fit_warning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    zone.id,
    String(b.customer_name).trim(),
    b.contact || null,
    num(b.quantity),
    b.item_label || null,
    num(b.item_l_ft),
    num(b.item_w_ft),
    num(b.item_h_ft),
    b.start_date || null,
    num(b.estimated_capacity),
    b.fit_warning || null
  );

  res.status(201).json({ id: Number(info.lastInsertRowid), space: zone.name });
});

export default router;
