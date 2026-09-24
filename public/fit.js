// Shared by the owner's picker and the customer booking page, so both answer
// "will it fit?" the same way.

const M_TO_FT = 3.280839895;

// Clearance left under beams, lights and sprinklers rather than stacking to the slab.
const HEADROOM_FT = 1;

// How much of a space's floor you actually get to use. A corner only needs access from
// two sides; an island in the middle of the floor needs it all the way round.
const WALL_OPTIONS = [
  { value: 0, label: 'Open on all sides', short: 'open on all sides', usable: 0.60 },
  { value: 1, label: 'Against one wall', short: 'one wall', usable: 0.70 },
  { value: 2, label: 'Corner — two walls', short: 'corner, two walls', usable: 0.75 },
  { value: 3, label: 'Alcove — three walls', short: 'alcove, three walls', usable: 0.80 },
];

function wallInfo(n) {
  return WALL_OPTIONS.find(w => w.value === Number(n)) || WALL_OPTIONS[0];
}

// Starting points only — every dimension stays editable, because real stock varies.
// `image` points at public/items/: drop a photograph in under the same name and the
// picker shows the photograph instead of the illustration.
const ITEM_PRESETS = [
  { id: 'carton-lg', name: 'Large carton', size: '600 × 400 × 400 mm', image: 'items/carton-lg.svg', l: 0.6, w: 0.4, h: 0.4 },
  { id: 'carton-sm', name: 'Small carton', size: '400 × 300 × 300 mm', image: 'items/carton-sm.svg', l: 0.4, w: 0.3, h: 0.3 },
  { id: 'bag-50', name: '50 kg bag', size: '900 × 550 × 250 mm', image: 'items/bag-50.svg', l: 0.9, w: 0.55, h: 0.25 },
  { id: 'bag-25', name: '25 kg bag', size: '700 × 450 × 200 mm', image: 'items/bag-25.svg', l: 0.7, w: 0.45, h: 0.2 },
  { id: 'bale', name: 'Pressed bale', size: '1100 × 550 × 700 mm', image: 'items/bale.svg', l: 1.1, w: 0.55, h: 0.7 },
  { id: 'pallet-std', name: 'Loaded pallet', size: '1200 × 1000 × 1200 mm', image: 'items/pallet.svg', l: 1.2, w: 1.0, h: 1.2 },
  { id: 'drum', name: '200 litre drum', size: 'ø 580 × 890 mm', image: 'items/drum.svg', l: 0.58, w: 0.58, h: 0.89 },
  { id: 'custom', name: 'Something else', size: 'I’ll type the size', image: 'items/custom.svg', l: null, w: null, h: null },
];

// The admin dropdown still wants a single line of text per item.
function presetLabel(p) {
  return p.id === 'custom' ? `${p.name} — ${p.size}` : `${p.name} (${p.size})`;
}

function presetById(id) {
  return ITEM_PRESETS.find(p => p.id === id) || null;
}

function makeItem({ l, w, h, unit = 'm', quantity, maxStack = null }) {
  const toFt = unit === 'm' ? M_TO_FT : 1;
  const lf = Number(l) * toFt;
  const wf = Number(w) * toFt;
  const hf = Number(h) * toFt;
  const qty = Math.floor(Number(quantity) || 0);
  if (!(lf > 0 && wf > 0 && hf > 0 && qty > 0)) return null;

  const cap = Math.floor(Number(maxStack) || 0);
  return { l: lf, w: wf, h: hf, qty, footprint: lf * wf, maxStack: cap > 0 ? cap : null };
}

function usableHeight(space) {
  return Math.max(Number(space.height_ft) - HEADROOM_FT, 0);
}

function spaceCapacity(zone, item) {
  const wall = wallInfo(zone.wall_support);
  const floorSqft = Number(zone.size_sqft) || 0;
  const usableFloor = floorSqft * wall.usable;
  const usableHeightFt = usableHeight(zone);

  let layers = Math.floor(usableHeightFt / item.h);
  const limitedByRule = item.maxStack !== null && item.maxStack < layers;
  if (limitedByRule) layers = item.maxStack;
  layers = Math.max(layers, 0);

  const perLayer = Math.floor(usableFloor / item.footprint);
  return {
    wall, floorSqft, usableFloor, usableHeight: usableHeightFt, layers, perLayer, limitedByRule,
    capacity: perLayer * layers,
  };
}
