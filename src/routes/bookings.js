import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT b.*, z.name AS zone_name
    FROM bookings b
    JOIN zones z ON z.id = b.zone_id
    ORDER BY b.created_at DESC, b.id DESC
  `).all());
});

router.delete('/:id', (req, res) => {
  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
