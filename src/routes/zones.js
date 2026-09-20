import { Router } from 'express';
import db from '../db.js';

const router = Router();

const SELECT_ZONES = `
  SELECT
    z.id, z.name, z.size_sqft, z.length_ft, z.width_ft, z.height_ft, z.wall_support, z.notes,
    (z.length_ft * z.width_ft * z.height_ft) AS volume_cuft,
    l.id AS active_lease_id, l.daily_rate AS active_rate, l.start_date AS active_start,
    v.id AS vendor_id, v.name AS vendor_name
  FROM zones z
  LEFT JOIN leases l ON l.zone_id = z.id AND l.end_date IS NULL
  LEFT JOIN vendors v ON v.id = l.vendor_id
`;

function readDimensions(body, existing) {
  const pick = (key) => (body[key] === undefined ? existing?.[key] : Number(body[key]));
  const length = pick('length_ft');
  const width = pick('width_ft');
  const height = pick('height_ft');

  for (const [label, value] of [['Length', length], ['Width', width], ['Height', height]]) {
    if (!(value > 0)) return { error: `${label} must be greater than zero` };
  }

  const wallRaw = body.wall_support === undefined ? existing?.wall_support ?? 0 : Number(body.wall_support);
  const wall = Math.min(3, Math.max(0, Math.round(wallRaw || 0)));

  return { length, width, height, wall, sizeSqft: length * width };
}

router.get('/', (req, res) => {
  res.json(db.prepare(`${SELECT_ZONES} ORDER BY z.name COLLATE NOCASE`).all());
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  if (!body.name || !String(body.name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const dims = readDimensions(body, null);
  if (dims.error) return res.status(400).json({ error: dims.error });

  try {
    const info = db.prepare(`
      INSERT INTO zones (name, size_sqft, length_ft, width_ft, height_ft, wall_support, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(String(body.name).trim(), dims.sizeSqft, dims.length, dims.width, dims.height, dims.wall, body.notes || null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'A space with that name already exists' });
    }
    throw e;
  }
});

router.patch('/:id', (req, res) => {
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'Space not found' });

  const body = req.body ?? {};
  const name = body.name === undefined ? zone.name : String(body.name).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const dims = readDimensions(body, zone);
  if (dims.error) return res.status(400).json({ error: dims.error });

  try {
    db.prepare(`
      UPDATE zones
      SET name = ?, size_sqft = ?, length_ft = ?, width_ft = ?, height_ft = ?, wall_support = ?, notes = ?
      WHERE id = ?
    `).run(
      name, dims.sizeSqft, dims.length, dims.width, dims.height, dims.wall,
      body.notes === undefined ? zone.notes : (body.notes || null),
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'A space with that name already exists' });
    }
    throw e;
  }
});

router.delete('/:id', (req, res) => {
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'Space not found' });

  const leaseCount = db.prepare('SELECT COUNT(*) AS c FROM leases WHERE zone_id = ?').get(req.params.id).c;
  if (leaseCount > 0) {
    return res.status(400).json({
      error: `This space has ${leaseCount} lease${leaseCount === 1 ? '' : 's'} on record. Delete those first if you really want it gone.`,
    });
  }

  db.prepare('DELETE FROM zones WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
