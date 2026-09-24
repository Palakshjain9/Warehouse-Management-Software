import { Router } from 'express';
import db from '../db.js';
import { secondsRemaining } from '../availability.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, s.name AS space_name
    FROM bookings b
    JOIN spaces s ON s.id = b.space_id
    ORDER BY b.start_date DESC, b.id DESC
  `).all();

  // A hold whose clock has run out is reported as expired even before anything
  // writes that status back.
  res.json(rows.map(b => ({
    ...b,
    status: b.status === 'held' && secondsRemaining(b.held_until) <= 0 ? 'expired' : b.status,
    seconds_remaining: b.status === 'held' ? secondsRemaining(b.held_until) : 0,
  })));
});

router.delete('/:id', (req, res) => {
  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/cancel', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  db.prepare("UPDATE bookings SET status = 'cancelled', held_until = NULL WHERE id = ?")
    .run(req.params.id);
  res.json({ ok: true });
});

export default router;
