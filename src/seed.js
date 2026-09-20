import db from './db.js';
import { daysAgoStr, daysOccupied } from './calc.js';

export function clearAll() {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM leases');
  db.exec('DELETE FROM vendors');
  db.exec('DELETE FROM zones');
}

// [name, length ft, width ft, height ft, walls, x, y, rotated, notes]
const ZONES = [
  ['Bay A1', 25, 20, 12, 2, 0, 0, 0, 'Corner by the main shutter'],
  ['Bay A2', 25, 20, 12, 1, 27, 0, 0, 'Along the north wall'],
  ['Dock Side D1', 20, 10, 12, 1, 56, 0, 0, 'Next to the loading dock'],
  ['Bay B1', 30, 25, 12, 1, 0, 25, 0, 'Along the west wall, rack-fitted'],
  ['Bay B2', 30, 25, 12, 0, 33, 28, 0, 'Island in the middle of the floor'],
  ['Mezzanine M1', 20, 15, 8, 3, 65, 25, 1, 'Upper level alcove, light goods only'],
];

const VENDORS = [
  ['Shree Balaji Traders', '98200 11223', 'Cotton bales'],
  ['Kumar Textiles', '99301 44556', 'Finished fabric rolls'],
  ['Nova Packaging', 'nova@example.com', 'Cartons and packing material'],
  ['Raj Distributors', '97654 88991', 'Moved out, may return next quarter'],
];

// [space, vendor, dailyRate, startDaysAgo, endDaysAgo, payments]
// A payment amount of 'full' settles the lease exactly, so the demo shows a zero balance.
const LEASES = [
  ['Bay A1', 'Shree Balaji Traders', 1200, 45, null, [[30000, 20, 'NEFT']]],
  ['Bay B1', 'Kumar Textiles', 1800, 30, null, [[25000, 22, 'Cheque 114502'], [20000, 8, 'UPI']]],
  ['Mezzanine M1', 'Nova Packaging', 600, 12, null, []],
  ['Bay A2', 'Raj Distributors', 1200, 90, 15, [['full', 14, 'Final settlement on move-out']]],
  ['Bay B2', 'Kumar Textiles', 1500, 60, 5, [[50000, 30, 'Part payment']]],
];

export function seedDemoData() {
  clearAll();

  const insertZone = db.prepare(`
    INSERT INTO zones (name, size_sqft, length_ft, width_ft, height_ft, wall_support, pos_x, pos_y, rotated, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const zoneIds = new Map(ZONES.map(([name, l, w, h, walls, x, y, rotated, notes]) =>
    [name, Number(insertZone.run(name, l * w, l, w, h, walls, x, y, rotated, notes).lastInsertRowid)]));

  const insertVendor = db.prepare('INSERT INTO vendors (name, contact, notes) VALUES (?, ?, ?)');
  const vendorIds = new Map(VENDORS.map(v => [v[0], Number(insertVendor.run(...v).lastInsertRowid)]));

  const insertLease = db.prepare(
    'INSERT INTO leases (zone_id, vendor_id, daily_rate, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPayment = db.prepare(
    'INSERT INTO payments (lease_id, amount, paid_date, notes) VALUES (?, ?, ?, ?)'
  );

  for (const [spaceName, vendorName, rate, startAgo, endAgo, payments] of LEASES) {
    const startDate = daysAgoStr(startAgo);
    const endDate = endAgo === null ? null : daysAgoStr(endAgo);
    const leaseId = Number(
      insertLease.run(zoneIds.get(spaceName), vendorIds.get(vendorName), rate, startDate, endDate).lastInsertRowid
    );

    for (const [amount, paidAgo, note] of payments) {
      const value = amount === 'full' ? daysOccupied(startDate, endDate) * rate : amount;
      insertPayment.run(leaseId, value, daysAgoStr(paidAgo), note);
    }
  }
}
