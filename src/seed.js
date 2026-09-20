import db from './db.js';
import { daysAgoStr, daysOccupied } from './calc.js';

export function clearAll() {
  db.exec('DELETE FROM bookings');
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM leases');
  db.exec('DELETE FROM vendors');
  db.exec('DELETE FROM zones');
  db.exec('DELETE FROM plan_image');
}

// [name, length ft, width ft, height ft, walls, rate/day, plan x, plan y, plan w, plan h, notes]
// The plan figures are only used to draw the placeholder layout below and the matching
// hotspots. Once a real drawing is uploaded, the owner marks the areas by hand.
const ZONES = [
  ['Bay A1', 25, 20, 12, 2, 1200, 0, 0, 25, 20, 'Corner by the main shutter'],
  ['Bay A2', 25, 20, 12, 1, 1200, 27, 0, 25, 20, 'Along the north wall'],
  ['Dock Side D1', 20, 10, 12, 1, 500, 56, 0, 20, 10, 'Next to the loading dock'],
  ['Bay B1', 30, 25, 12, 1, 1800, 0, 25, 30, 25, 'Along the west wall, rack-fitted'],
  ['Bay B2', 30, 25, 12, 0, 1500, 33, 28, 30, 25, 'Island in the middle of the floor'],
  ['Mezzanine M1', 20, 15, 8, 3, 600, 65, 25, 15, 20, 'Upper level alcove, light goods only'],
];

const PLAN_MARGIN_FT = 4;
const PLAN_SCALE = 12;

// Stands in for the owner's own drawing so the booking flow can be seen before one is
// uploaded. Replaced the moment a real layout goes up.
function placeholderDrawing(extentX, extentY) {
  const w = extentX * PLAN_SCALE;
  const h = extentY * PLAN_SCALE;
  const rooms = ZONES.map(([name, , , height, , , x, y, pw, ph]) => {
    const rx = (x + PLAN_MARGIN_FT) * PLAN_SCALE;
    const ry = (y + PLAN_MARGIN_FT) * PLAN_SCALE;
    return `<g>
      <rect x="${rx}" y="${ry}" width="${pw * PLAN_SCALE}" height="${ph * PLAN_SCALE}"
            fill="#ffffff" stroke="#3c3c46" stroke-width="3"/>
      <text x="${rx + (pw * PLAN_SCALE) / 2}" y="${ry + (ph * PLAN_SCALE) / 2 - 4}"
            text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#23232b">${name}</text>
      <text x="${rx + (pw * PLAN_SCALE) / 2}" y="${ry + (ph * PLAN_SCALE) / 2 + 20}"
            text-anchor="middle" font-family="Georgia, serif" font-size="15" fill="#6b6b74">${pw} x ${ph} ft, ${height} ft high</text>
    </g>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#fbf9f3"/>
    <rect x="${PLAN_MARGIN_FT * PLAN_SCALE / 2}" y="${PLAN_MARGIN_FT * PLAN_SCALE / 2}"
          width="${w - PLAN_MARGIN_FT * PLAN_SCALE}" height="${h - PLAN_MARGIN_FT * PLAN_SCALE}"
          fill="none" stroke="#23232b" stroke-width="6"/>
    ${rooms}
    <text x="${w / 2}" y="${h - 14}" text-anchor="middle" font-family="Georgia, serif"
          font-size="16" fill="#9a9aa2">Sample layout - replace with your own drawing</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

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

  const extentX = Math.max(...ZONES.map(z => z[6] + z[8])) + PLAN_MARGIN_FT * 2;
  const extentY = Math.max(...ZONES.map(z => z[7] + z[9])) + PLAN_MARGIN_FT * 2;

  const insertZone = db.prepare(`
    INSERT INTO zones
      (name, size_sqft, length_ft, width_ft, height_ft, wall_support, list_rate_per_day,
       hot_x, hot_y, hot_w, hot_h, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const zoneIds = new Map(ZONES.map(([name, l, w, h, walls, rate, x, y, pw, ph, notes]) => [
    name,
    Number(insertZone.run(
      name, l * w, l, w, h, walls, rate,
      (x + PLAN_MARGIN_FT) / extentX, (y + PLAN_MARGIN_FT) / extentY, pw / extentX, ph / extentY,
      notes
    ).lastInsertRowid),
  ]));

  db.prepare('INSERT INTO plan_image (id, data_url) VALUES (1, ?)')
    .run(placeholderDrawing(extentX, extentY));

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
