import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const vendors = db.prepare(`
    SELECT
      v.*,
      (SELECT COUNT(*) FROM leases l WHERE l.vendor_id = v.id) AS lease_count,
      (SELECT COUNT(*) FROM leases l WHERE l.vendor_id = v.id AND l.end_date IS NULL) AS active_lease_count
    FROM vendors v
    ORDER BY v.name COLLATE NOCASE
  `).all();
  res.json(vendors);
});

router.post('/', (req, res) => {
  const { name, contact, notes } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const info = db.prepare('INSERT INTO vendors (name, contact, notes) VALUES (?, ?, ?)')
    .run(String(name).trim(), contact || null, notes || null);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const { name, contact, notes } = req.body ?? {};
  const newName = name === undefined ? vendor.name : String(name).trim();
  if (!newName) return res.status(400).json({ error: 'Name is required' });

  db.prepare('UPDATE vendors SET name = ?, contact = ?, notes = ? WHERE id = ?').run(
    newName,
    contact === undefined ? vendor.contact : (contact || null),
    notes === undefined ? vendor.notes : (notes || null),
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const leaseCount = db.prepare('SELECT COUNT(*) AS c FROM leases WHERE vendor_id = ?').get(req.params.id).c;
  if (leaseCount > 0) {
    return res.status(400).json({
      error: `This vendor has ${leaseCount} lease${leaseCount === 1 ? '' : 's'} on record. Delete those first if you really want them gone.`,
    });
  }

  db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
