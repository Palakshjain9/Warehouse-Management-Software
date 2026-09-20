import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zonesRouter from './src/routes/zones.js';
import vendorsRouter from './src/routes/vendors.js';
import leasesRouter from './src/routes/leases.js';
import paymentsRouter from './src/routes/payments.js';
import dashboardRouter from './src/routes/dashboard.js';
import demoRouter from './src/routes/demo.js';
import planRouter from './src/routes/plan.js';
import publicRouter from './src/routes/public.js';
import bookingsRouter from './src/routes/bookings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// The layout drawing is posted as a data URL, so the default 100kb body cap is too small.
app.use(express.json({ limit: '10mb' }));

app.use('/api/zones', zonesRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/leases', leasesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/demo', demoRouter);
app.use('/api/plan', planRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/public', publicRouter);

app.get('/book', (req, res) => res.sendFile(path.join(__dirname, 'public', 'book.html')));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Warehouse rental MVP running at http://localhost:${PORT}`);
});
