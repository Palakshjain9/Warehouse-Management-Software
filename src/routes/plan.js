import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Raster only. A drawing is rendered through an <img>, where an SVG's scripts would not
// run anyway, but keeping the set narrow avoids the question entirely.
const ALLOWED = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_BYTES = 8 * 1024 * 1024;

router.get('/image', (req, res) => {
  const row = db.prepare('SELECT data_url, uploaded_at FROM plan_image WHERE id = 1').get();
  res.json(row ?? { data_url: null, uploaded_at: null });
});

router.put('/image', (req, res) => {
  const dataUrl = req.body?.data_url;
  if (typeof dataUrl !== 'string' || !ALLOWED.test(dataUrl)) {
    return res.status(400).json({ error: 'Upload a PNG, JPEG or WebP image of your layout' });
  }
  if (dataUrl.length > MAX_BYTES) {
    return res.status(400).json({ error: 'That image is too large — keep it under about 6 MB' });
  }

  db.prepare(`
    INSERT INTO plan_image (id, data_url, uploaded_at) VALUES (1, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data_url = excluded.data_url, uploaded_at = excluded.uploaded_at
  `).run(dataUrl);
  res.json({ ok: true });
});

router.delete('/image', (req, res) => {
  db.prepare('DELETE FROM plan_image WHERE id = 1').run();
  db.prepare('UPDATE zones SET hot_x = NULL, hot_y = NULL, hot_w = NULL, hot_h = NULL').run();
  res.json({ ok: true });
});

export default router;
