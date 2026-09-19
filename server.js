import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zonesRouter from './src/routes/zones.js';
import vendorsRouter from './src/routes/vendors.js';
import leasesRouter from './src/routes/leases.js';
import paymentsRouter from './src/routes/payments.js';
import dashboardRouter from './src/routes/dashboard.js';
import demoRouter from './src/routes/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

app.use('/api/zones', zonesRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/leases', leasesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/demo', demoRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Warehouse rental MVP running at http://localhost:${PORT}`);
});
