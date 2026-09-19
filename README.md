# Warehouse Rental MVP

Rent out warehouse space to multiple vendors on a per-day basis. This is a minimal
version built to test the idea with real numbers before adding more features.

## What it does

- **Zones** — define named spaces in your warehouse with a size in sq ft. Edit or
  delete them; a zone with leases on record can't be deleted by accident.
- **Vendors** — who you're renting to, with a count of their leases.
- **Leases** — assign a vendor to a zone at a daily rate starting on a date.
  A zone can only have one active lease at a time; end a lease to free the zone up,
  or reopen one you ended by mistake.
- **Payments** — log payments against a lease, remove ones entered wrongly, and see
  the outstanding balance (an overpayment shows as a credit).
- **Lease details** — click **Details** on any lease for the full working: rate,
  billing period, days billed, `rate × days = accrued`, payments received, and the
  resulting balance, so every number on the dashboard can be checked by hand.
- **Dashboard** — occupancy, total daily rent from active leases, and total
  outstanding dues across all leases.

### Sample data

The dashboard has a **Load sample data** button (and a **Clear everything** button
next to it). It fills the app with six zones, four vendors, three running leases,
two closed ones, and a mix of part-payments and a fully settled account — enough to
show someone how the whole thing works without typing anything in. Dates are
generated relative to today, so the day counts always look live.

Loading sample data replaces whatever is currently in the app, so clear it out
before you start entering real numbers.

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

## Deploying (so you can open it on your phone)

This repo includes a `render.yaml`, so [Render](https://render.com) can deploy it
in a few clicks:

1. Sign up at render.com (free, no credit card needed for this).
2. Dashboard → **New +** → **Blueprint**.
3. Connect your GitHub account and pick this repo
   (`Palakshjain9/Warehouse-Management-Software`).
4. Render detects `render.yaml` and proposes a free web service — click **Apply**.
5. Wait for the first deploy to finish, then open the `https://<something>.onrender.com`
   URL it gives you, from any device, including your phone's browser.

**Data persistence caveat:** Render's free plan doesn't include a persistent disk,
so the SQLite file lives in the container's local filesystem. It survives the
service sleeping and waking back up (it spins down after 15 minutes idle), but a
new deploy (e.g. pushing a code update) starts a fresh filesystem and wipes it.
That's fine for kicking the tires — once you're ready to rely on this for real
bookkeeping, ask and we'll move storage to a small hosted database so it survives
deploys.

## Currency

Amounts render as `₹` with Indian digit grouping. Both are set at the top of
`public/app.js` (`CURRENCY` and `LOCALE`) — change those two lines for anything else.

## Not included yet

Intentionally left out until the idea is validated: a visual floor plan of the
zones, invoices/PDFs, multi-warehouse support, login/accounts, payment gateways,
and reminders/notifications. Ask and we can add any of these next.
