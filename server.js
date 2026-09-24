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
import { MODE, mayBook, rememberCode, requireBooking } from './src/access.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const page = (name) => path.join(__dirname, 'public', name);

// The layout drawing is posted as a data URL, so the default 100kb body cap is too small.
app.use(express.json({ limit: '10mb' }));

app.use('/api/spaces', spacesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/demo', demoRouter);
app.use('/api/plan', planRouter);

// Whether the customer side is open at all. Says nothing about the basement, so
// it answers whether or not the visitor is allowed in.
app.get('/api/public/access', (req, res) => {
  res.json({ open: mayBook(req), code_required: MODE === 'code' });
});

app.use('/api/public', requireBooking, publicRouter);

function customerPage(file) {
  return (req, res) => {
    if (!mayBook(req)) return res.status(403).sendFile(page('locked.html'));
    rememberCode(req, res);
    res.sendFile(page(file));
  };
}

app.get('/book', customerPage('book.html'));

// The split-layout version of the same flow, live alongside /book so the two can
// be compared before either is retired.
app.get('/book-new', customerPage('book-new.html'));

// Both pages sit in the folder that's served as-is, so their files would
// otherwise be reachable straight off the disk and skip the check above.
app.get(['/book.html', '/book-new.html'], (req, res) => res.redirect(req.path.replace('.html', '')));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  if (seedIfEmpty()) console.log('No spaces on record — loaded the sample area.');
  console.log(`Customer pages: ${MODE}${MODE === 'locked'
    ? ' (set CUSTOMER_ACCESS=open, or to a code, to let people in)' : ''}`);
  console.log(`Basement Storage running at http://localhost:${PORT}`);
});
