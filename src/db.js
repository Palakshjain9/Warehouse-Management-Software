import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'storage.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    size_sqft REAL,
    length_ft REAL,
    width_ft REAL,
    height_ft REAL,
    wall_support INTEGER NOT NULL DEFAULT 0,
    price_per_day REAL,
    hot_x REAL,
    hot_y REAL,
    hot_w REAL,
    hot_h REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES spaces(id),
    customer_name TEXT,
    contact TEXT,
    start_date TEXT NOT NULL,
    days INTEGER NOT NULL,
    end_date TEXT NOT NULL,
    quantity INTEGER,
    item_label TEXT,
    item_l_ft REAL,
    item_w_ft REAL,
    item_h_ft REAL,
    estimated_capacity INTEGER,
    fit_warning TEXT,
    amount REAL,
    status TEXT NOT NULL DEFAULT 'held',
    held_until TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plan_image (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_url TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export default db;
