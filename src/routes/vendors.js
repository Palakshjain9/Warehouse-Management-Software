import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const vendors = db.prepare('SELECT * FROM vendors ORDER BY name COLLATE NOCASE').all();
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

export default router;
