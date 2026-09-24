import { Router } from 'express';
import db from '../db.js';
import { todayStr } from '../calc.js';
import { takenSpaceIds } from '../availability.js';

const router = Router();

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
  const spaces = db.prepare(`
    SELECT *, (length_ft * width_ft * height_ft) AS volume_cuft
    FROM spaces ORDER BY name COLLATE NOCASE
  `).all();

  const taken = takenSpaceIds(todayStr(), 1);
  res.json(spaces.map(s => ({ ...s, booked_today: taken.has(s.id) })));
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
      INSERT INTO spaces (name, size_sqft, length_ft, width_ft, height_ft, wall_support, price_per_day, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(body.name).trim(), dims.sizeSqft, dims.length, dims.width, dims.height, dims.wall,
           body.price_per_day ? Number(body.price_per_day) : null, body.notes || null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'A space with that name already exists' });
    }
    throw e;
  }
});

router.patch('/:id', (req, res) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id);
  if (!space) return res.status(404).json({ error: 'Space not found' });

  const body = req.body ?? {};
  const name = body.name === undefined ? space.name : String(body.name).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const dims = readDimensions(body, space);
  if (dims.error) return res.status(400).json({ error: dims.error });

  try {
    db.prepare(`
      UPDATE spaces
      SET name = ?, size_sqft = ?, length_ft = ?, width_ft = ?, height_ft = ?, wall_support = ?,
          price_per_day = ?, notes = ?
      WHERE id = ?
    `).run(
      name, dims.sizeSqft, dims.length, dims.width, dims.height, dims.wall,
      body.price_per_day === undefined
        ? space.price_per_day
        : (body.price_per_day ? Number(body.price_per_day) : null),
      body.notes === undefined ? space.notes : (body.notes || null),
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

// Hotspots are fractions of the drawing (0-1), so they survive the image being
// displayed at any size. Kept apart from the main PATCH so marking an area never has
// to satisfy dimension validation.
router.patch('/:id/hotspot', (req, res) => {
  const space = db.prepare('SELECT id FROM spaces WHERE id = ?').get(req.params.id);
  if (!space) return res.status(404).json({ error: 'Space not found' });

  const { hot_x, hot_y, hot_w, hot_h } = req.body ?? {};
  if ([hot_x, hot_y, hot_w, hot_h].some(v => v === null || v === undefined)) {
    db.prepare('UPDATE spaces SET hot_x = NULL, hot_y = NULL, hot_w = NULL, hot_h = NULL WHERE id = ?')
      .run(req.params.id);
    return res.json({ ok: true });
  }

  const clamp = v => Math.min(1, Math.max(0, Number(v)));
  const x = clamp(hot_x);
  const y = clamp(hot_y);
  const w = Math.min(clamp(hot_w), 1 - x);
  const h = Math.min(clamp(hot_h), 1 - y);
  if (!(w > 0.005 && h > 0.005)) {
    return res.status(400).json({ error: 'That area is too small to tap — draw a bigger box' });
  }

  db.prepare('UPDATE spaces SET hot_x = ?, hot_y = ?, hot_w = ?, hot_h = ? WHERE id = ?')
    .run(x, y, w, h, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id);
  if (!space) return res.status(404).json({ error: 'Space not found' });

  const bookingCount = db.prepare('SELECT COUNT(*) AS c FROM bookings WHERE space_id = ?')
    .get(req.params.id).c;
  if (bookingCount > 0) {
    return res.status(400).json({
      error: `This space has ${bookingCount} booking${bookingCount === 1 ? '' : 's'} on record. Delete those first if you really want it gone.`,
    });
  }

  db.prepare('DELETE FROM spaces WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
