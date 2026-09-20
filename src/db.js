import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'warehouse.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    size_sqft REAL,
    length_ft REAL,
    width_ft REAL,
    height_ft REAL,
    wall_support INTEGER NOT NULL DEFAULT 0,
    list_rate_per_day REAL,
    hot_x REAL,
    hot_y REAL,
    hot_w REAL,
    hot_h REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL REFERENCES zones(id),
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    daily_rate REAL NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lease_id INTEGER NOT NULL REFERENCES leases(id),
    amount REAL NOT NULL,
    paid_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plan_image (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_url TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL REFERENCES zones(id),
    customer_name TEXT NOT NULL,
    contact TEXT,
    quantity INTEGER,
    item_label TEXT,
    item_l_ft REAL,
    item_w_ft REAL,
    item_h_ft REAL,
    start_date TEXT,
    estimated_capacity INTEGER,
    fit_warning TEXT,
    status TEXT NOT NULL DEFAULT 'awaiting_payment',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Databases created before spaces had dimensions still need the newer columns.
for (const [column, definition] of [
  ['length_ft', 'REAL'],
  ['width_ft', 'REAL'],
  ['height_ft', 'REAL'],
  ['wall_support', 'INTEGER NOT NULL DEFAULT 0'],
  ['list_rate_per_day', 'REAL'],
  ['hot_x', 'REAL'],
  ['hot_y', 'REAL'],
  ['hot_w', 'REAL'],
  ['hot_h', 'REAL'],
]) {
  const exists = db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get('zones', column);
  if (!exists) db.exec(`ALTER TABLE zones ADD COLUMN ${column} ${definition}`);
}

export default db;
