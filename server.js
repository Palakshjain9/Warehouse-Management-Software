import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spacesRouter from './src/routes/spaces.js';
import bookingsRouter from './src/routes/bookings.js';
import dashboardRouter from './src/routes/dashboard.js';
import demoRouter from './src/routes/demo.js';
import planRouter from './src/routes/plan.js';
import publicRouter from './src/routes/public.js';
import { seedIfEmpty } from './src/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// The layout drawing is posted as a data URL, so the default 100kb body cap is too small.
app.use(express.json({ limit: '10mb' }));

app.use('/api/spaces', spacesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/demo', demoRouter);
app.use('/api/plan', planRouter);
app.use('/api/public', publicRouter);

app.get('/book', (req, res) => res.sendFile(path.join(__dirname, 'public', 'book.html')));

// The split-layout version of the same flow, live alongside /book so the two can
// be compared before either is retired.
app.get('/book-new', (req, res) => res.sendFile(path.join(__dirname, 'public', 'book-new.html')));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  if (seedIfEmpty()) console.log('No spaces on record — loaded the sample area.');
  console.log(`Basement Storage running at http://localhost:${PORT}`);
});
