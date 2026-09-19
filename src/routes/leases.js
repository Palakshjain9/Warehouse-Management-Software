import { Router } from 'express';
import db from '../db.js';
import { daysOccupied, accruedRent, todayStr } from '../calc.js';

const router = Router();

function withTotals(lease) {
  const accrued = accruedRent(lease);
  const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE lease_id = ?')
    .get(lease.id).total;
  return {
    ...lease,
    days_occupied: daysOccupied(lease.start_date, lease.end_date),
    accrued,
    paid,
    balance: accrued - paid,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, z.name AS zone_name, v.name AS vendor_name
    FROM leases l
    JOIN zones z ON z.id = l.zone_id
    JOIN vendors v ON v.id = l.vendor_id
    ORDER BY (l.end_date IS NOT NULL), l.start_date DESC, l.id DESC
  `).all();

  const paid = new Map(
    db.prepare('SELECT lease_id, SUM(amount) AS total FROM payments GROUP BY lease_id').all()
      .map(r => [r.lease_id, r.total])
  );

  res.json(rows.map(l => {
    const accrued = accruedRent(l);
    const paidTotal = paid.get(l.id) || 0;
    return {
      ...l,
      days_occupied: daysOccupied(l.start_date, l.end_date),
      accrued,
      paid: paidTotal,
      balance: accrued - paidTotal,
    };
  }));
});

router.get('/:id', (req, res) => {
  const lease = db.prepare(`
    SELECT l.*, z.name AS zone_name, z.size_sqft, v.name AS vendor_name, v.contact AS vendor_contact
    FROM leases l
    JOIN zones z ON z.id = l.zone_id
    JOIN vendors v ON v.id = l.vendor_id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!lease) return res.status(404).json({ error: 'Lease not found' });

  const payments = db.prepare('SELECT * FROM payments WHERE lease_id = ? ORDER BY paid_date DESC, id DESC')
    .all(req.params.id);

  res.json({ ...withTotals(lease), billed_through: lease.end_date ?? todayStr(), payments });
});

router.post('/', (req, res) => {
  const { zone_id, vendor_id, daily_rate, start_date } = req.body ?? {};
  if (!zone_id || !vendor_id || !daily_rate || Number(daily_rate) <= 0 || !start_date) {
    return res.status(400).json({ error: 'zone_id, vendor_id, a positive daily_rate and start_date are required' });
  }

  const zone = db.prepare('SELECT id FROM zones WHERE id = ?').get(zone_id);
  if (!zone) return res.status(400).json({ error: 'Zone not found' });
  const vendor = db.prepare('SELECT id FROM vendors WHERE id = ?').get(vendor_id);
  if (!vendor) return res.status(400).json({ error: 'Vendor not found' });

  const active = db.prepare('SELECT id FROM leases WHERE zone_id = ? AND end_date IS NULL').get(zone_id);
  if (active) return res.status(400).json({ error: 'This zone already has an active lease. End it first.' });

  const info = db.prepare(
    'INSERT INTO leases (zone_id, vendor_id, daily_rate, start_date) VALUES (?, ?, ?, ?)'
  ).run(zone_id, vendor_id, Number(daily_rate), start_date);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const lease = db.prepare('SELECT * FROM leases WHERE id = ?').get(req.params.id);
  if (!lease) return res.status(404).json({ error: 'Lease not found' });

  const body = req.body ?? {};
  const rate = body.daily_rate === undefined ? lease.daily_rate : Number(body.daily_rate);
  if (!(rate > 0)) return res.status(400).json({ error: 'Daily rate must be greater than zero' });

  const startDate = body.start_date === undefined ? lease.start_date : body.start_date;
  if (!startDate) return res.status(400).json({ error: 'Start date is required' });

  const endDate = body.end_date === undefined ? lease.end_date : (body.end_date || null);
  if (endDate && endDate < startDate) {
    return res.status(400).json({ error: 'End date cannot be before the start date' });
  }

  if (!endDate && lease.end_date) {
    const active = db.prepare('SELECT id FROM leases WHERE zone_id = ? AND end_date IS NULL AND id != ?')
      .get(lease.zone_id, lease.id);
    if (active) {
      return res.status(400).json({ error: 'That zone already has another active lease, so this one cannot be reopened.' });
    }
  }

  db.prepare('UPDATE leases SET daily_rate = ?, start_date = ?, end_date = ? WHERE id = ?')
    .run(rate, startDate, endDate, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const lease = db.prepare('SELECT * FROM leases WHERE id = ?').get(req.params.id);
  if (!lease) return res.status(404).json({ error: 'Lease not found' });

  db.prepare('DELETE FROM payments WHERE lease_id = ?').run(req.params.id);
  db.prepare('DELETE FROM leases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/end', (req, res) => {
  const lease = db.prepare('SELECT * FROM leases WHERE id = ?').get(req.params.id);
  if (!lease) return res.status(404).json({ error: 'Lease not found' });
  if (lease.end_date) return res.status(400).json({ error: 'Lease already ended' });

  const endDate = req.body?.end_date || todayStr();
  if (endDate < lease.start_date) {
    return res.status(400).json({ error: 'End date cannot be before the start date' });
  }

  db.prepare('UPDATE leases SET end_date = ? WHERE id = ?').run(endDate, req.params.id);
  res.json({ ok: true });
});

router.get('/:id/payments', (req, res) => {
  const payments = db.prepare('SELECT * FROM payments WHERE lease_id = ? ORDER BY paid_date DESC, id DESC')
    .all(req.params.id);
  res.json(payments);
});

router.post('/:id/payments', (req, res) => {
  const lease = db.prepare('SELECT * FROM leases WHERE id = ?').get(req.params.id);
  if (!lease) return res.status(404).json({ error: 'Lease not found' });

  const { amount, paid_date, notes } = req.body ?? {};
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'A positive amount is required' });
  }

  db.prepare('INSERT INTO payments (lease_id, amount, paid_date, notes) VALUES (?, ?, ?, ?)')
    .run(req.params.id, Number(amount), paid_date || todayStr(), notes || null);
  res.status(201).json({ ok: true });
});

export default router;
