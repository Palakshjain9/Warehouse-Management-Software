import { randomUUID } from 'node:crypto';
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

function groupRows(groupId) {
  return db.prepare(`
    SELECT b.*, s.name AS space_name, s.price_per_day
    FROM bookings b JOIN spaces s ON s.id = b.space_id
    WHERE b.group_id = ?
    ORDER BY s.name COLLATE NOCASE
  `).all(groupId);
}

// Deliberately narrow: a customer sees what a space is and whether it is available for
// the dates they asked about — never who booked it, what they paid, or anything else
// about the other customers.
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

// Reaching checkout holds every space the customer picked. They share a group_id so the
// set is confirmed, released and shown as one booking, while availability stays a
// per-space question. All or nothing: if any one has gone, none are held.
router.post('/holds', (req, res) => {
  const b = req.body ?? {};
  const ids = [...new Set((Array.isArray(b.space_ids) ? b.space_ids : [b.space_id]).map(Number))]
    .filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one space' });

  const spaces = ids.map(id => db.prepare('SELECT * FROM spaces WHERE id = ?').get(id)).filter(Boolean);
  if (spaces.length !== ids.length) return res.status(400).json({ error: 'One of those spaces no longer exists' });

  const { start, days } = readRange({ start: b.start_date, days: b.days });
  const gone = spaces.filter(s => !isSpaceFree(s.id, start, days));
  if (gone.length) {
    return res.status(409).json({
      error: `${gone.map(s => s.name).join(' and ')} ${gone.length === 1 ? 'has' : 'have'} just been taken for those dates. Please pick again.`,
    });
  }

  const num = v => (v === '' || v === undefined || v === null ? null : Number(v));
  const groupId = randomUUID();
  const endDate = endDateFor(start, days);

  const insert = db.prepare(`
    INSERT INTO bookings
      (space_id, group_id, start_date, days, end_date, quantity, item_label,
       item_l_ft, item_w_ft, item_h_ft, estimated_capacity, fit_warning,
       amount, status, held_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', datetime('now', ?))
  `);

  // The quantity and fit note describe the whole load, so they sit on the first row
  // rather than being split across spaces that cannot each claim them.
  spaces.forEach((s, i) => {
    insert.run(
      s.id, groupId, start, days, endDate,
      i === 0 ? num(b.quantity) : null,
      i === 0 ? (b.item_label || null) : null,
      i === 0 ? num(b.item_l_ft) : null,
      i === 0 ? num(b.item_w_ft) : null,
      i === 0 ? num(b.item_h_ft) : null,
      i === 0 ? num(b.estimated_capacity) : null,
      i === 0 ? (b.fit_warning || null) : null,
      s.price_per_day ? Number(s.price_per_day) * days : null,
      `+${HOLD_SECONDS} seconds`
    );
  });

  const rows = groupRows(groupId);
  res.status(201).json({
    group_id: groupId,
    spaces: rows.map(r => ({ name: r.space_name, amount: r.amount })),
    amount: rows.reduce((sum, r) => sum + (r.amount || 0), 0),
    start_date: start,
    days,
    end_date: endDate,
    seconds_remaining: HOLD_SECONDS,
  });
});

router.get('/holds/:groupId', (req, res) => {
  const rows = groupRows(req.params.groupId);
  if (!rows.length) return res.status(404).json({ error: 'Booking not found' });

  const left = rows[0].status === 'held' ? secondsRemaining(rows[0].held_until) : 0;
  res.json({
    group_id: req.params.groupId,
    status: rows[0].status === 'held' && left <= 0 ? 'expired' : rows[0].status,
    seconds_remaining: left,
  });
});

// The clock is enforced here, not in the browser — a stale page cannot buy an expired hold.
router.post('/holds/:groupId/pay', (req, res) => {
  const rows = groupRows(req.params.groupId);
  if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
  if (rows[0].status === 'confirmed') return res.json({ ok: true, already: true });
  if (rows[0].status !== 'held') {
    return res.status(410).json({ error: 'That hold is no longer open.', expired: true });
  }
  if (secondsRemaining(rows[0].held_until) <= 0) {
    db.prepare("UPDATE bookings SET status = 'expired' WHERE group_id = ?").run(req.params.groupId);
    return res.status(410).json({
      error: 'Your hold ran out and the spaces were released.',
      expired: true,
    });
  }

  const name = String(req.body?.customer_name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Please give us a name to put on the booking' });

  // Someone else may have confirmed one of these while the hold was open.
  const clash = rows.filter(r => !isSpaceFree(r.space_id, r.start_date, r.days, { excludeId: r.id }));
  if (clash.length) {
    db.prepare("UPDATE bookings SET status = 'expired' WHERE group_id = ?").run(req.params.groupId);
    return res.status(409).json({
      error: `${clash.map(r => r.space_name).join(' and ')} was confirmed by someone else just now. Please pick again.`,
      expired: true,
    });
  }

  db.prepare(`
    UPDATE bookings
    SET status = 'confirmed', customer_name = ?, contact = ?, email = ?, whatsapp = ?,
        paid_at = datetime('now'), held_until = NULL
    WHERE group_id = ?
  `).run(
    name,
    req.body?.contact || null,
    req.body?.email || null,
    req.body?.whatsapp ? 1 : 0,
    req.params.groupId
  );

  res.json({
    ok: true,
    spaces: rows.map(r => r.space_name),
    amount: rows.reduce((sum, r) => sum + (r.amount || 0), 0),
  });
});

router.post('/holds/:groupId/release', (req, res) => {
  db.prepare("UPDATE bookings SET status = 'expired' WHERE group_id = ? AND status = 'held'")
    .run(req.params.groupId);
  res.json({ ok: true });
});

export default router;
