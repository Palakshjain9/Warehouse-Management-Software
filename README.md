# Warehouse Rental MVP

Rent out warehouse space to multiple vendors on a per-day basis. This is a minimal
version built to test the idea with real numbers before adding more features.

## What it does

- **Spaces** — mark out your basement into named spaces, each with a length, width
  and height (so floor area and volume are worked out for you) and a note of how much
  wall support it has: open on all sides, against one wall, a corner, or an alcove.
  Edit or delete them; a space with leases on record can't be deleted by accident.
- **Vendors** — who you're renting to, with a count of their leases.
- **Leases** — assign a vendor to a space at a daily rate starting on a date.
  A space can only have one active lease at a time; end a lease to free it up,
  or reopen one you ended by mistake.
- **Payments** — log payments against a lease, remove ones entered wrongly, and see
  the outstanding balance (an overpayment shows as a credit).
- **Lease details** — click **Details** on any lease for the full working: rate,
  billing period, days billed, `rate × days = accrued`, payments received, and the
  resulting balance, so every number on the dashboard can be checked by hand.
- **Dashboard** — occupancy, total daily rent from active leases, and total
  outstanding dues across all leases.

### Space picker

A separate tab that answers "will my goods fit, and where?". Describe the load the way
an owner actually knows it — how many items, and roughly how big one of them is (pick a
preset or type the size) — and for every space it works out **how many of those items
that space holds**, then names the one to offer.

For each space it takes:

- the usable floor, which is where wall support earns its keep: a corner only needs
  access from two sides, so more of its floor is stackable than an island in the middle
  of the room (60% open / 70% one wall / 75% corner / 80% alcove)
- the layers that fit under that space's own ceiling, less 1 ft of headroom — so you're
  never asked how high to stack, unless you want to cap it for fragile goods
- the indicative rent, at a rate defaulted to the average ₹/sq ft/day across your own
  active leases rather than an invented market figure

Recommended space is the **smallest one that fits**, since floor area is what gets
charged for. Every row shows its working, so a vendor can check the number rather than
trust it. Counts are approximate: usable floor is divided by one item's footprint, so
it assumes goods pack reasonably tightly.

The item presets and the usable-floor percentages are starting points from general
warehousing practice, not measurements of your basement — adjust `WALL_OPTIONS` and
`HEADROOM_FT` in `public/app.js` once you know how your own space really behaves.

### Sample data

The dashboard has a **Load sample data** button (and a **Clear everything** button
next to it). It fills the app with six measured spaces, four vendors, three running leases,
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
spaces, invoices/PDFs, multi-warehouse support, login/accounts, payment gateways,
and reminders/notifications. Ask and we can add any of these next.
