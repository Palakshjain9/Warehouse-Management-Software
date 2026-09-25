import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import db from '../db.js';
import { todayStr, endDateFor } from '../calc.js';
import { isSpaceFree, secondsRemaining } from '../availability.js';

const router = Router();

// An agreed total split back across the spaces it covers, in proportion to what
// each one lists at, so per-space amounts stay meaningful after a discount. Any
// rounding lands on the last space, so the parts always add up to the total.
function shareOut(total, listed) {
  const sum = listed.reduce((a, b) => a + b, 0);
  const round = v => Math.round(v * 100) / 100;
  const parts = listed.map(v => round(sum > 0 ? (v / sum) * total : total / listed.length));
  parts[parts.length - 1] = round(parts[parts.length - 1] + (total - parts.reduce((a, b) => a + b, 0)));
  return parts;
}

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
        paid: !!row.paid_at,
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

// The owner taking a booking themselves — someone who rang up or walked in. Same
// rules as the customer page, minus the hold: there is nobody to hold it for.
router.post('/', (req, res) => {
  const b = req.body ?? {};
  const ids = [...new Set((Array.isArray(b.space_ids) ? b.space_ids : [b.space_id]).map(Number))]
    .filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one space' });

  const name = String(b.customer_name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Whose booking is it? A name is needed' });

  const spaces = ids.map(id => db.prepare('SELECT * FROM spaces WHERE id = ?').get(id)).filter(Boolean);
  if (spaces.length !== ids.length) {
    return res.status(400).json({ error: 'One of those spaces no longer exists' });
  }

  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : todayStr();
  const days = Math.min(365, Math.max(1, Math.floor(Number(b.days) || 1)));

  const clash = spaces.filter(s => !isSpaceFree(s.id, start, days));
  if (clash.length) {
    return res.status(409).json({
      error: `${clash.map(s => s.name).join(' and ')} ${clash.length === 1 ? 'is' : 'are'} already booked for those dates.`,
    });
  }

  const listed = spaces.map(s => (s.price_per_day ? Number(s.price_per_day) * days : 0));
  const agreed = b.amount === '' || b.amount === null || b.amount === undefined ? null : Number(b.amount);
  const amounts = agreed !== null && Number.isFinite(agreed) && agreed >= 0
    ? shareOut(agreed, listed)
    : listed;

  const num = v => (v === '' || v === undefined || v === null ? null : Number(v));
  const groupId = randomUUID();
  const endDate = endDateFor(start, days);
  const paid = !!b.paid;

  const insert = db.prepare(`
    INSERT INTO bookings
      (space_id, group_id, customer_name, contact, email, whatsapp,
       start_date, days, end_date, quantity, item_label, amount, status, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ${paid ? "datetime('now')" : 'NULL'})
  `);

  // The load description belongs to the booking, not to each space, so it sits on
  // the first row — the same way the customer page records it.
  spaces.forEach((s, i) => {
    insert.run(
      s.id, groupId, name, b.contact || null, b.email || null, b.whatsapp ? 1 : 0,
      start, days, endDate,
      i === 0 ? num(b.quantity) : null,
      i === 0 ? (b.item_label || null) : null,
      amounts[i] || null
    );
  });

  res.status(201).json({
    group_id: groupId,
    spaces: spaces.map((s, i) => ({ name: s.name, amount: amounts[i] })),
    amount: amounts.reduce((a, c) => a + c, 0),
    start_date: start,
    end_date: endDate,
    days,
    paid,
  });
});

router.post('/:groupId/paid', (req, res) => {
  const info = db.prepare(`
    UPDATE bookings SET paid_at = datetime('now')
    WHERE group_id = ? AND status = 'confirmed' AND paid_at IS NULL
  `).run(req.params.groupId);
  if (!Number(info.changes)) {
    return res.status(404).json({ error: 'Nothing left to mark paid on that booking' });
  }
  res.json({ ok: true });
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
