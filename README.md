# Basement Storage

Short-stay storage in a basement: the owner marks the floor into spaces, customers pick
one off a plan, say what they're storing, and book it for a few days.

This is a working prototype running on a **hypothetical sample area**, so the whole loop
can be exercised before the real basement is measured.

## The sample area

A hypothetical **60 × 54 ft** floor, **12 ft clear height throughout**, cut into a 3 × 3
grid of nine spaces. Column widths vary so the fit check gets a real workout, and the
middle-centre piece is an island so every wall-support class appears.

| Space | Size | Floor | Walls | Price/day |
|-------|------|-------|-------|-----------|
| A1, B1, C1 | 24 × 18 ft | 432 sq ft | corner / one wall / corner | ₹1,080 |
| A2, B2, C2 | 20 × 18 ft | 360 sq ft | one wall / **island** / one wall | ₹900 |
| A3, B3, C3 | 16 × 18 ft | 288 sq ft | corner / one wall / corner | ₹720 |

3,240 sq ft in total, priced at a flat ₹2.50/sq ft/day so every figure is checkable by
hand. Height is stored per space, so the real basement can carry varying heights later.

## The customer flow — `/book`

A page you can send to customers. It shows none of the admin: no other customers' names,
prices or booking history.

1. **Dates first.** Which spaces are free depends on when you want them, so the dates come
   before the plan. Change the dates and the colours change with them.
2. **Pick a space.** Tap an area on the plan. Press and hold to see its floor area, height
   and price for the chosen dates first.
   - 🟩 **green** — available  🟦 **blue** — your pick  🟥 **red** — booked
3. **What you're storing.** How many, and what kind of thing. Based on a typical size for
   that kind of item, it gives a *soft caution* if the quantity looks like more than the
   space holds — it never blocks, since the customer knows their goods better than the
   estimate does. Ticking "I know the exact size" swaps in their figures and re-checks.
4. **Checkout, against the clock.** Reaching checkout puts the space **on hold for two
   minutes**, with a countdown on screen. Finish in time and it's confirmed; run out and
   the hold is refused and the space goes back on the market.

The hold is real: while it runs, the space reads as booked to everyone else. The clock is
enforced on the server, so a stale page can't buy an expired hold.

Hold length comes from the `HOLD_SECONDS` env var (default 120) — tests set it to a few
seconds rather than waiting two minutes.

**Payment is not connected.** The last step is a clearly marked placeholder. Wiring a real
provider needs an account, API keys and a webhook to confirm payment before a space is
held for good.

## The admin

- **Dashboard** — spaces, booked and free today, value of confirmed bookings, what's
  starting later.
- **Floor plan** — upload a picture of your layout with the spaces marked on it, then drag
  a box over each one to make it tappable. Boxes are stored as a share of the picture, so
  they stay put at any screen size, and the overlay only tints an area rather than
  labelling it, so your own markings stay readable. PNG, JPEG or WebP up to about 6 MB.
  Only areas you have marked appear to customers.
- **Spaces** — dimensions, wall support, price per day. Area and volume are worked out for
  you. A space with bookings on record can't be deleted by accident.
- **Bookings** — everything booked through the customer page, including holds in flight and
  the fit caution the customer saw. Cancel frees the space up again.
- **Space picker** — your own copy of the fit check, showing the full working for every
  space.

## How the fit check works

For each space it takes the **usable floor** — which is where wall support earns its keep,
since a corner only needs access from two sides while an island needs it all the way round
(60% open / 70% one wall / 75% corner / 80% alcove) — and the **layers** that fit under
that space's own ceiling, less 1 ft of headroom.

Counts are approximate: usable floor is divided by one item's footprint, so it assumes
goods pack reasonably tightly. The presets and percentages are starting points from general
warehousing practice, not measurements of your basement — adjust `WALL_OPTIONS` and
`HEADROOM_FT` in `public/fit.js` once you know how your own space behaves.

## Running it

```bash
npm install
npm start
```

Admin at http://localhost:3000, customer page at http://localhost:3000/book.

Data lives in a local SQLite file at `data/storage.db`, created automatically and not
committed.

## Deploying

`render.yaml` is included, so [Render](https://render.com) deploys it in a few clicks:
Dashboard → **New +** → **Blueprint** → pick this repo → **Apply**.

**Render's free plan has no persistent disk**, so a new deploy starts a fresh filesystem
and wipes the data. Fine while this is a prototype — press **Load sample data** after each
deploy. Before real customers use it, storage needs to move to a hosted database.

## Currency

Amounts render as `₹` with Indian digit grouping, set at the top of `public/app.js` and
`public/book.js` (`CURRENCY` and `LOCALE`).

## Not built yet

Real payment processing, refunds, and any login — the admin is currently open to anyone
with the link, which is fine for a prototype but not once customers can reach it. The real
basement measurements are still to come: when they're settled, upload the drawing, mark the
areas and edit the nine sample spaces into the real ones.
