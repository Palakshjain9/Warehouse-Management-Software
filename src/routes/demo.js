import { Router } from 'express';
import { seedDemoData, clearAll } from '../seed.js';

const router = Router();

router.post('/seed', (req, res) => {
  seedDemoData();
  res.json({ ok: true });
});

router.post('/reset', (req, res) => {
  clearAll();
  res.json({ ok: true });
});

export default router;
