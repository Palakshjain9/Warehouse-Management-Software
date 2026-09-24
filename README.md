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
2. **Pick spaces.** Tap an area on the plan — tap several if one isn't enough, and they
   book together as a single booking. Press and hold to see floor area, usable height and
   price first.
   - 🟩 **green** — available  🟦 **blue** — your picks  🟥 **red** — booked
3. **What you're storing.** Pick the kind of thing from a picture grid (cartons, 25 kg and
   50 kg bags, bales, pallets, drums) and say how many. Where several spaces are picked,
   their capacity is added up. Based on a typical size for that kind of item, it gives a
   *soft caution* if the quantity looks like more than the
   space holds — it never blocks, since the customer knows their goods better than the
   estimate does. Ticking "I know the exact size" swaps in their figures and re-checks.
4. **Checkout, against the clock.** Reaching checkout puts every picked space **on hold for
   five minutes**, with a countdown on screen. Name plus a mobile number or email; the
   mobile has a *this number is on WhatsApp* tick. Finish in time and it's confirmed; run
   out and the hold is refused and the spaces go back on the market.

Checkout states plainly that **loading and unloading is settled directly with the labour** —
the charge here is for the space only.

The hold is real: while it runs, the space reads as booked to everyone else. The clock is
enforced on the server, so a stale page can't buy an expired hold.

Hold length comes from the `HOLD_SECONDS` env var (default 300) — tests set it to a few
seconds rather than waiting two minutes.

**Payment is not connected.** The last step is a clearly marked placeholder. Wiring a real
provider needs an account, API keys and a webhook to confirm payment before a space is
held for good.

## The same flow, laid out differently — `/book-new`

A second copy of the customer page, live alongside `/book` so the two can be compared
side by side before either is retired. Same server, same rules, same money — only the
layout differs.

Instead of four full-width steps stacked down the page, it is a **split view**: the plan on
the left, and a rail on the right carrying the dates, the tapped space's facts, the running
total and the button. Picking a space, reading its details and watching the total move all
happen without scrolling. The dates sit in the rail rather than on a screen of their own, so
changing them re-colours the plan in place. Three stages instead of four — pick, goods,
checkout — and each one fills a 1280 × 800 screen exactly, with no scroll.

On a phone two columns can't survive, so the plan goes across the top and the rail becomes
a **sheet at the bottom of the screen** with the total and the button always in view. Under
the plan is a plain **list of the same spaces** with an Add button each, because a thumb
misses small areas on a hand-drawn plan. The list and the plan stay in step — picking in
one shows in the other.

Checkout carries the plan a second time, marked with nothing but the spaces on hold, so
there's no doubt about which corner of the basement is being paid for.

Nothing on `/book` changed. Both pages read and write the same bookings, so a hold taken on
one shows as booked on the other.

### Item pictures

The grid draws from `ITEM_PRESETS` in `public/fit.js`, and each entry points at a file in
`public/items/`. Those are line illustrations at the moment — drop a photograph in under
the same filename and the picker shows the photograph instead, no code change.

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

Admin at http://localhost:3000, customer page at http://localhost:3000/book, and the
split-layout version of it at http://localhost:3000/book-new.

Data lives in a local SQLite file at `data/storage.db`, created automatically and not
committed.

## Deploying

`render.yaml` is included, so [Render](https://render.com) deploys it in a few clicks:
Dashboard → **New +** → **Blueprint** → pick this repo → **Apply**.

**Render's free plan has no persistent disk**, so a new deploy starts a fresh filesystem
and wipes the data. Fine while this is a prototype — press **Load sample data** after each
deploy. Before real customers use it, storage needs to move to a hosted database.

## Currency

Amounts render as `₹` with Indian digit grouping, set at the top of `public/app.js`,
`public/book.js` and `public/book-new.js` (`CURRENCY` and `LOCALE`).

## Not built yet

Real payment processing, refunds, and any login — the admin is currently open to anyone
with the link, which is fine for a prototype but not once customers can reach it. The real
basement measurements are still to come: when they're settled, upload the drawing, mark the
areas and edit the nine sample spaces into the real ones.
