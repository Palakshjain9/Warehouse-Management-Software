# Warehouse Rental MVP

Rent out warehouse space to multiple vendors on a per-day basis. This is a minimal
version built to test the idea with real numbers before adding more features.

## What it does

- **Zones** — define named spaces in your warehouse with a size in sq ft.
- **Vendors** — who you're renting to.
- **Leases** — assign a vendor to a zone at a daily rate starting on a date.
  A zone can only have one active lease at a time; end a lease to free the zone up.
- **Payments** — log payments against a lease and see the outstanding balance.
- **Dashboard** — occupancy, total daily revenue from active leases, and total
  outstanding dues across all leases.

### Rent accrual rule

A lease's accrued rent is `daily_rate × days_occupied`, where the start day counts
as day 1 — so a lease that starts today already owes one day's rent. An ended lease
stops accruing on its end date. Adjust `src/calc.js` if your convention differs
(e.g. free move-in day, or don't count the end day).

## Running it

```bash
npm install
npm start
```

Then open http://localhost:3000

Data is stored in a local SQLite file at `data/warehouse.db` (created automatically,
not committed to git).

## Not included yet

Intentionally left out until the idea is validated: invoices/PDFs, multi-warehouse
support, login/accounts, payment gateways, reminders/notifications, editing or
deleting zones/vendors/leases after creation. Ask and we can add any of these next.
