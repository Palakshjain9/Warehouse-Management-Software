import db from './db.js';
import { daysAgoStr, daysOccupied } from './calc.js';

export function clearAll() {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM leases');
  db.exec('DELETE FROM vendors');
  db.exec('DELETE FROM zones');
}

const ZONES = [
  ['Bay A1', 500, 'Ground floor, near main shutter'],
  ['Bay A2', 500, 'Ground floor'],
  ['Bay B1', 750, 'Ground floor, rack-fitted'],
  ['Bay B2', 750, 'Ground floor, rack-fitted'],
  ['Mezzanine M1', 300, 'Upper level, light goods only'],
  ['Dock Side D1', 200, 'Next to loading dock'],
];

const VENDORS = [
  ['Shree Balaji Traders', '98200 11223', 'Cotton bales'],
  ['Kumar Textiles', '99301 44556', 'Finished fabric rolls'],
  ['Nova Packaging', 'nova@example.com', 'Cartons and packing material'],
  ['Raj Distributors', '97654 88991', 'Moved out, may return next quarter'],
];

// [zoneIndex, vendorIndex, dailyRate, startDaysAgo, endDaysAgo, payments]
// A payment amount of 'full' settles the lease exactly, so the demo shows a zero balance.
const LEASES = [
  [0, 0, 1200, 45, null, [[30000, 20, 'NEFT']]],
  [2, 1, 1800, 30, null, [[25000, 22, 'Cheque 114502'], [20000, 8, 'UPI']]],
  [4, 2, 600, 12, null, []],
  [1, 3, 1200, 90, 15, [['full', 14, 'Final settlement on move-out']]],
  [3, 1, 1500, 60, 5, [[50000, 30, 'Part payment']]],
];

export function seedDemoData() {
  clearAll();

  const insertZone = db.prepare('INSERT INTO zones (name, size_sqft, notes) VALUES (?, ?, ?)');
  const zoneIds = ZONES.map(z => Number(insertZone.run(...z).lastInsertRowid));

  const insertVendor = db.prepare('INSERT INTO vendors (name, contact, notes) VALUES (?, ?, ?)');
  const vendorIds = VENDORS.map(v => Number(insertVendor.run(...v).lastInsertRowid));

  const insertLease = db.prepare(
    'INSERT INTO leases (zone_id, vendor_id, daily_rate, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPayment = db.prepare(
    'INSERT INTO payments (lease_id, amount, paid_date, notes) VALUES (?, ?, ?, ?)'
  );

  for (const [zi, vi, rate, startAgo, endAgo, payments] of LEASES) {
    const startDate = daysAgoStr(startAgo);
    const endDate = endAgo === null ? null : daysAgoStr(endAgo);
    const leaseId = Number(
      insertLease.run(zoneIds[zi], vendorIds[vi], rate, startDate, endDate).lastInsertRowid
    );

    for (const [amount, paidAgo, note] of payments) {
      const value = amount === 'full' ? daysOccupied(startDate, endDate) * rate : amount;
      insertPayment.run(leaseId, value, daysAgoStr(paidAgo), note);
    }
  }
}
