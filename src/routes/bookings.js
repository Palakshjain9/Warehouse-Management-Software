import { Router } from 'express';
import db from '../db.js';
import { secondsRemaining } from '../availability.js';

const router = Router();

// Several spaces booked together share a group_id, so the owner sees one line per
// booking rather than one per space.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, s.name AS space_name
    FROM bookings b
    JOIN spaces s ON s.id = b.space_id
    ORDER BY b.start_date DESC, b.id DESC
  `).all();

  const groups = new Map();
  for (const row of rows) {
    const existing = groups.get(row.group_id);
    if (!existing) {
      const left = row.status === 'held' ? secondsRemaining(row.held_until) : 0;
      groups.set(row.group_id, {
        group_id: row.group_id,
        space_names: [row.space_name],
        space_ids: [row.space_id],
        customer_name: row.customer_name,
        contact: row.contact,
        email: row.email,
        whatsapp: !!row.whatsapp,
        start_date: row.start_date,
        end_date: row.end_date,
        days: row.days,
        quantity: row.quantity,
        item_label: row.item_label,
        fit_warning: row.fit_warning,
        amount: row.amount || 0,
        status: row.status === 'held' && left <= 0 ? 'expired' : row.status,
        seconds_remaining: left,
        created_at: row.created_at,
      });
      continue;
    }
    existing.space_names.push(row.space_name);
    existing.space_ids.push(row.space_id);
    existing.amount += row.amount || 0;
    // Only the first row of a group carries the load details.
    existing.quantity ??= row.quantity;
    existing.item_label ??= row.item_label;
    existing.fit_warning ??= row.fit_warning;
  }

  res.json([...groups.values()]);
});

router.delete('/:groupId', (req, res) => {
  const info = db.prepare('DELETE FROM bookings WHERE group_id = ?').run(req.params.groupId);
  if (!Number(info.changes)) return res.status(404).json({ error: 'Booking not found' });
  res.json({ ok: true });
});

router.post('/:groupId/cancel', (req, res) => {
  const info = db.prepare("UPDATE bookings SET status = 'cancelled', held_until = NULL WHERE group_id = ?")
    .run(req.params.groupId);
  if (!Number(info.changes)) return res.status(404).json({ error: 'Booking not found' });
  res.json({ ok: true });
});

export default router;
