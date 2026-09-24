import { randomUUID } from 'node:crypto';
import db from './db.js';
import { daysAgoStr, endDateFor, todayStr, addDays } from './calc.js';

export function clearAll() {
  db.exec('DELETE FROM bookings');
  db.exec('DELETE FROM spaces');
  db.exec('DELETE FROM plan_image');
}

// A hypothetical 60 x 54 ft area, 12 ft clear throughout, cut into a 3 x 3 grid.
// Column widths vary so the fit maths gets a real workout, and the middle-centre piece
// is an island so all three wall-support classes appear.
// [name, length ft (across), width ft (deep), height ft, walls, price/day, x, y, notes]
const SPACES = [
  ['A1', 24, 18, 12, 2, 1080, 0, 0, 'Corner by the entrance'],
  ['A2', 20, 18, 12, 1, 900, 24, 0, 'Along the north wall'],
  ['A3', 16, 18, 12, 2, 720, 44, 0, 'North-east corner'],
  ['B1', 24, 18, 12, 1, 1080, 0, 18, 'Along the west wall'],
  ['B2', 20, 18, 12, 0, 900, 24, 18, 'Island in the middle of the floor'],
  ['B3', 16, 18, 12, 1, 720, 44, 18, 'Along the east wall'],
  ['C1', 24, 18, 12, 2, 1080, 0, 36, 'South-west corner'],
  ['C2', 20, 18, 12, 1, 900, 24, 36, 'Along the south wall'],
  ['C3', 16, 18, 12, 2, 720, 44, 36, 'South-east corner, next to the shutter'],
];

const PLAN_MARGIN_FT = 4;
const PLAN_SCALE = 12;

// [space, customer, contact, startDaysFromToday, days, quantity, item, note]
// Spread across dates on purpose: A1 covers today, B2 starts next week, so the plan's
// colours visibly change as the customer moves the dates.
const BOOKINGS = [
  ['A1', 'Mehta Exports', '98200 11223', -2, 6, 900, 'Carton, large', null],
  ['C3', 'Shree Balaji Traders', '99301 44556', 0, 3, 400, 'Sack or bag, 50 kg', null],
  ['B2', 'Nova Packaging', 'nova@example.com', 7, 5, 250, 'Carton, large', null],
  ['A3', 'Kumar Textiles', '97654 88991', -20, 4, 600, 'Pressed bale', null],
];

// Stands in for the owner's own drawing so the booking flow can be seen before a real
// layout goes up. Replaced the moment one is uploaded.
function placeholderDrawing(extentX, extentY) {
  const w = extentX * PLAN_SCALE;
  const h = extentY * PLAN_SCALE;

  const rooms = SPACES.map(([name, l, wd, height, , , x, y]) => {
    const rx = (x + PLAN_MARGIN_FT) * PLAN_SCALE;
    const ry = (y + PLAN_MARGIN_FT) * PLAN_SCALE;
    return `<g>
      <rect x="${rx}" y="${ry}" width="${l * PLAN_SCALE}" height="${wd * PLAN_SCALE}"
            fill="#ffffff" stroke="#3c3c46" stroke-width="3"/>
      <text x="${rx + (l * PLAN_SCALE) / 2}" y="${ry + (wd * PLAN_SCALE) / 2 - 6}"
            text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#23232b">${name}</text>
      <text x="${rx + (l * PLAN_SCALE) / 2}" y="${ry + (wd * PLAN_SCALE) / 2 + 20}"
            text-anchor="middle" font-family="Georgia, serif" font-size="15" fill="#6b6b74">${l} x ${wd} ft, ${height} ft high</text>
    </g>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#fbf9f3"/>
    <rect x="${PLAN_MARGIN_FT * PLAN_SCALE / 2}" y="${PLAN_MARGIN_FT * PLAN_SCALE / 2}"
          width="${w - PLAN_MARGIN_FT * PLAN_SCALE}" height="${h - PLAN_MARGIN_FT * PLAN_SCALE}"
          fill="none" stroke="#23232b" stroke-width="6"/>
    ${rooms}
    <text x="${w / 2}" y="${h - 14}" text-anchor="middle" font-family="Georgia, serif"
          font-size="16" fill="#9a9aa2">Sample area, 60 x 54 ft - replace with your own drawing</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Render's free plan starts every deploy on a fresh filesystem, so the database
// is empty again and the customer page has nothing to show — no spaces, no plan.
// While this is a prototype, fill it rather than hand a visitor an empty site.
// Once real spaces are entered and the data is kept properly, drop this.
export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM spaces').get();
  if (n > 0) return false;
  seedDemoData();
  return true;
}

export function seedDemoData() {
  clearAll();

  const extentX = Math.max(...SPACES.map(s => s[6] + s[1])) + PLAN_MARGIN_FT * 2;
  const extentY = Math.max(...SPACES.map(s => s[7] + s[2])) + PLAN_MARGIN_FT * 2;

  const insertSpace = db.prepare(`
    INSERT INTO spaces
      (name, size_sqft, length_ft, width_ft, height_ft, wall_support, price_per_day,
       hot_x, hot_y, hot_w, hot_h, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const spaceIds = new Map(SPACES.map(([name, l, wd, h, walls, price, x, y, notes]) => [
    name,
    Number(insertSpace.run(
      name, l * wd, l, wd, h, walls, price,
      (x + PLAN_MARGIN_FT) / extentX, (y + PLAN_MARGIN_FT) / extentY, l / extentX, wd / extentY,
      notes
    ).lastInsertRowid),
  ]));

  db.prepare('INSERT INTO plan_image (id, data_url) VALUES (1, ?)')
    .run(placeholderDrawing(extentX, extentY));

  const prices = new Map(SPACES.map(s => [s[0], s[5]]));
  const insertBooking = db.prepare(`
    INSERT INTO bookings
      (space_id, group_id, customer_name, contact, email, whatsapp,
       start_date, days, end_date, quantity, item_label, amount, status, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now'))
  `);

  for (const [spaceName, customer, contact, offset, days, quantity, item] of BOOKINGS) {
    const start = offset < 0 ? daysAgoStr(-offset) : addDays(todayStr(), offset);
    insertBooking.run(
      spaceIds.get(spaceName), randomUUID(), customer, contact, null, 1,
      start, days, endDateFor(start, days), quantity, item, prices.get(spaceName) * days
    );
  }
}
