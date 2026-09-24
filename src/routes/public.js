import { Router } from 'express';
import db from '../db.js';
import { todayStr, endDateFor } from '../calc.js';
import { HOLD_SECONDS, isSpaceFree, takenSpaceIds, secondsRemaining } from '../availability.js';

const router = Router();

function readRange(query) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(query.start || '') ? query.start : todayStr();
  const days = Math.min(365, Math.max(1, Math.floor(Number(query.days) || 1)));
  return { start, days };
}

// Deliberately narrow: a customer sees what a space is and whether it is free for the
// dates they asked about — never who booked it, what they paid, or anything else about
// the other customers.
router.get('/spaces', (req, res) => {
  const { start, days } = readRange(req.query);
  const taken = takenSpaceIds(start, days);

  const spaces = db.prepare(`
    SELECT id, name, size_sqft, length_ft, width_ft, height_ft, wall_support,
           price_per_day, hot_x, hot_y, hot_w, hot_h
    FROM spaces
    WHERE hot_w IS NOT NULL
    ORDER BY name COLLATE NOCASE
  `).all();

  res.json({
    start,
    days,
    end: endDateFor(start, days),
    spaces: spaces.map(s => ({ ...s, available: !taken.has(s.id) })),
  });
});

router.get('/plan-image', (req, res) => {
  const row = db.prepare('SELECT data_url FROM plan_image WHERE id = 1').get();
  res.json(row ?? { data_url: null });
});

// Reaching checkout puts the space on hold. The amount is worked out here from the
// space's own price so the client cannot name its own figure.
router.post('/holds', (req, res) => {
  const b = req.body ?? {};
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(b.space_id);
  if (!space) return res.status(400).json({ error: 'Pick a space first' });

  const { start, days } = readRange({ start: b.start_date, days: b.days });
  if (!isSpaceFree(space.id, start, days)) {
    return res.status(409).json({ error: 'Sorry — that space has just been taken for those dates. Please pick another.' });
  }

  const num = v => (v === '' || v === undefined || v === null ? null : Number(v));
  const amount = space.price_per_day ? Number(space.price_per_day) * days : null;

  const info = db.prepare(`
    INSERT INTO bookings
      (space_id, start_date, days, end_date, quantity, item_label,
       item_l_ft, item_w_ft, item_h_ft, estimated_capacity, fit_warning,
       amount, status, held_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', datetime('now', ?))
  `).run(
    space.id, start, days, endDateFor(start, days),
    num(b.quantity), b.item_label || null,
    num(b.item_l_ft), num(b.item_w_ft), num(b.item_h_ft),
    num(b.estimated_capacity), b.fit_warning || null,
    amount, `+${HOLD_SECONDS} seconds`
  );

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    space: space.name,
    amount,
    start_date: start,
    days,
    end_date: endDateFor(start, days),
    seconds_remaining: HOLD_SECONDS,
  });
});

router.get('/holds/:id', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const left = booking.status === 'held' ? secondsRemaining(booking.held_until) : 0;
  res.json({
    id: booking.id,
    status: booking.status === 'held' && left <= 0 ? 'expired' : booking.status,
    seconds_remaining: left,
  });
});

// The clock is enforced here, not in the browser — a stale page cannot buy an expired hold.
router.post('/bookings/:id/pay', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status === 'confirmed') return res.json({ ok: true, already: true });
  if (booking.status !== 'held') {
    return res.status(410).json({ error: 'That hold is no longer open.', expired: true });
  }
  if (secondsRemaining(booking.held_until) <= 0) {
    db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?").run(booking.id);
    return res.status(410).json({
      error: 'Your hold ran out and the space was released. Please pick again.',
      expired: true,
    });
  }

  const name = String(req.body?.customer_name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Please give us a name to put on the booking' });

  // Someone else may have confirmed the same dates while this hold was open.
  if (!isSpaceFree(booking.space_id, booking.start_date, booking.days, { excludeId: booking.id })) {
    db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?").run(booking.id);
    return res.status(409).json({
      error: 'That space was confirmed by someone else just now. Please pick another.',
      expired: true,
    });
  }

  db.prepare(`
    UPDATE bookings
    SET status = 'confirmed', customer_name = ?, contact = ?, paid_at = datetime('now'), held_until = NULL
    WHERE id = ?
  `).run(name, req.body?.contact || null, booking.id);

  const space = db.prepare('SELECT name FROM spaces WHERE id = ?').get(booking.space_id);
  res.json({ ok: true, space: space.name, amount: booking.amount });
});

router.post('/holds/:id/release', (req, res) => {
  db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'held'")
    .run(req.params.id);
  res.json({ ok: true });
});

export default router;
