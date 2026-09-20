const CURRENCY = '₹';
const LOCALE = 'en-IN';

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = { zones: [], vendors: [], leases: [] };
let openLeaseId = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function money(n) {
  return CURRENCY + Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---- Modal ----
function showModal(title, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#modal-body').innerHTML = '';
  openLeaseId = null;
}

// ---- Balance presentation ----
function balanceCell(balance) {
  if (balance > 0) return { text: money(balance), cls: 'balance-positive' };
  if (balance < 0) return { text: `Credit ${money(-balance)}`, cls: 'balance-credit' };
  return { text: money(0), cls: 'balance-zero' };
}

// ---- Dashboard ----
async function loadDashboard() {
  const stats = await api('/api/dashboard');
  $('#stat-zones').textContent = stats.zoneCount;
  $('#stat-occupied').textContent = stats.occupied;
  $('#stat-vacant').textContent = stats.vacant;
  $('#stat-sqft').textContent = Number(stats.totalSqft || 0).toLocaleString(LOCALE);
  $('#stat-revenue').textContent = money(stats.dailyRevenue);
  $('#stat-outstanding').textContent = money(stats.outstanding);

  const isEmpty = stats.zoneCount === 0 && state.vendors.length === 0;
  $('#empty-state').classList.toggle('hidden', !isEmpty);
  $('#dashboard-content').classList.toggle('hidden', isEmpty);

  const active = state.leases.filter(l => !l.end_date);
  const tbody = $('#active-leases-table tbody');
  if (active.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No active leases right now.</td></tr>';
    return;
  }
  tbody.innerHTML = active.map(l => {
    const bal = balanceCell(l.balance);
    return `<tr>
      <td data-label="Space">${escapeHtml(l.zone_name)}</td>
      <td data-label="Vendor">${escapeHtml(l.vendor_name)}</td>
      <td data-label="Rate/day">${money(l.daily_rate)}</td>
      <td data-label="Start">${fmtDate(l.start_date)}</td>
      <td data-label="Days">${l.days_occupied}</td>
      <td data-label="Accrued">${money(l.accrued)}</td>
      <td data-label="Paid">${money(l.paid)}</td>
      <td data-label="Balance" class="${bal.cls}">${bal.text}</td>
      <td data-label="" class="row-actions">
        <button data-action="lease-detail" data-id="${l.id}">Details</button>
      </td>
    </tr>`;
  }).join('');
}

// ---- Zones ----
async function loadZones() {
  state.zones = await api('/api/zones');
  const tbody = $('#zones-table tbody');
  if (state.zones.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No spaces yet. Add one above.</td></tr>';
  } else {
    tbody.innerHTML = state.zones.map(z => `<tr>
      <td data-label="Name">
        ${escapeHtml(z.name)}
        ${z.notes ? `<div class="cell-note">${escapeHtml(z.notes)}</div>` : ''}
      </td>
      <td data-label="Dimensions">${z.length_ft ? `${z.length_ft} × ${z.width_ft} × ${z.height_ft} ft` : '—'}</td>
      <td data-label="Floor">${z.size_sqft == null ? '—' : `${Number(z.size_sqft).toLocaleString(LOCALE)} sq ft`}</td>
      <td data-label="Volume">${z.volume_cuft ? `${Math.round(z.volume_cuft).toLocaleString(LOCALE)} cu ft` : '—'}</td>
      <td data-label="Walls">${escapeHtml(wallInfo(z.wall_support).short)}</td>
      <td data-label="Status">${z.active_lease_id
        ? `<span class="badge occupied">Taken — ${escapeHtml(z.vendor_name)}</span>`
        : '<span class="badge vacant">Vacant</span>'}</td>
      <td data-label="" class="row-actions">
        <button data-action="zone-edit" data-id="${z.id}">Edit</button>
        <button data-action="zone-delete" data-id="${z.id}" class="danger-text">Delete</button>
      </td>
    </tr>`).join('');
  }

  const select = $('#lease-zone-select');
  const vacant = state.zones.filter(z => !z.active_lease_id);
  select.innerHTML = vacant.length
    ? vacant.map(z => `<option value="${z.id}">${escapeHtml(z.name)}${z.size_sqft ? ` (${z.size_sqft} sq ft)` : ''}</option>`).join('')
    : '<option value="">No vacant spaces</option>';
}

// ---- Vendors ----
async function loadVendors() {
  state.vendors = await api('/api/vendors');
  const tbody = $('#vendors-table tbody');
  if (state.vendors.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No vendors yet. Add one above.</td></tr>';
  } else {
    tbody.innerHTML = state.vendors.map(v => `<tr>
      <td data-label="Name">${escapeHtml(v.name)}</td>
      <td data-label="Contact">${escapeHtml(v.contact || '')}</td>
      <td data-label="Leases">${v.lease_count}${v.active_lease_count ? ` (${v.active_lease_count} active)` : ''}</td>
      <td data-label="Notes">${escapeHtml(v.notes || '')}</td>
      <td data-label="" class="row-actions">
        <button data-action="vendor-edit" data-id="${v.id}">Edit</button>
        <button data-action="vendor-delete" data-id="${v.id}" class="danger-text">Delete</button>
      </td>
    </tr>`).join('');
  }

  const select = $('#lease-vendor-select');
  select.innerHTML = state.vendors.length
    ? state.vendors.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')
    : '<option value="">No vendors yet</option>';
}

// ---- Leases ----
async function loadLeases() {
  state.leases = await api('/api/leases');
  const tbody = $('#leases-table tbody');
  if (state.leases.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No leases yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.leases.map(l => {
    const bal = balanceCell(l.balance);
    return `<tr class="${l.end_date ? 'row-ended' : ''}">
      <td data-label="Space">${escapeHtml(l.zone_name)}</td>
      <td data-label="Vendor">${escapeHtml(l.vendor_name)}</td>
      <td data-label="Rate/day">${money(l.daily_rate)}</td>
      <td data-label="Start">${fmtDate(l.start_date)}</td>
      <td data-label="End">${l.end_date ? fmtDate(l.end_date) : '<span class="badge vacant">Active</span>'}</td>
      <td data-label="Days">${l.days_occupied}</td>
      <td data-label="Accrued">${money(l.accrued)}</td>
      <td data-label="Paid">${money(l.paid)}</td>
      <td data-label="Balance" class="${bal.cls}">${bal.text}</td>
      <td data-label="" class="row-actions">
        <button data-action="lease-detail" data-id="${l.id}">Details</button>
      </td>
    </tr>`;
  }).join('');
}

// ---- Lease detail ----
async function openLeaseDetail(id) {
  const lease = await api(`/api/leases/${id}`);
  openLeaseId = id;
  const bal = balanceCell(lease.balance);
  const endLabel = lease.end_date
    ? `${fmtDate(lease.end_date)} (ended)`
    : `${fmtDate(lease.billed_through)} (today)`;

  const paymentRows = lease.payments.length
    ? lease.payments.map(p => `<tr>
        <td>${fmtDate(p.paid_date)}</td>
        <td>${money(p.amount)}</td>
        <td>${escapeHtml(p.notes || '')}</td>
        <td class="row-actions"><button data-action="payment-delete" data-id="${p.id}" class="danger-text">Remove</button></td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="4">No payments recorded yet.</td></tr>';

  showModal(`${lease.zone_name} · ${lease.vendor_name}`, `
    <div class="calc-block">
      <div class="calc-row"><span>Daily rate</span><span>${money(lease.daily_rate)} / day</span></div>
      <div class="calc-row"><span>Billed from</span><span>${fmtDate(lease.start_date)}</span></div>
      <div class="calc-row"><span>Billed through</span><span>${endLabel}</span></div>
      <div class="calc-row"><span>Days billed</span><span>${lease.days_occupied}</span></div>
      <div class="calc-row calc-sum">
        <span>Accrued rent</span>
        <span>${money(lease.accrued)} <em>= ${money(lease.daily_rate)} × ${lease.days_occupied}</em></span>
      </div>
      <div class="calc-row"><span>Payments received</span><span>− ${money(lease.paid)}</span></div>
      <div class="calc-row calc-total"><span>Balance due</span><span class="${bal.cls}">${bal.text}</span></div>
    </div>

    <h4>Payments</h4>
    <div class="table-wrap compact">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
        <tbody>${paymentRows}</tbody>
      </table>
    </div>

    <h4>Record a payment</h4>
    <form id="detail-payment-form" class="inline-form tight">
      <input type="number" name="amount" placeholder="Amount" min="0" step="any" required>
      <input type="date" name="paid_date" value="${todayStr()}" required>
      <input type="text" name="notes" placeholder="Note (optional)">
      <button type="submit">Add</button>
    </form>
    <p class="error" id="detail-error"></p>

    <div class="modal-actions">
      <button data-action="lease-edit" data-id="${lease.id}">Edit lease</button>
      ${lease.end_date
        ? `<button data-action="lease-reopen" data-id="${lease.id}">Reopen</button>`
        : `<button data-action="lease-end" data-id="${lease.id}">End lease</button>`}
      <button data-action="lease-delete" data-id="${lease.id}" class="danger">Delete lease</button>
    </div>
  `);
}

function openZoneEdit(id) {
  const z = state.zones.find(x => x.id === Number(id));
  if (!z) return;
  showModal('Edit space', `
    <form id="edit-form" data-kind="zone" data-id="${z.id}">
      <label>Name<input type="text" name="name" value="${escapeHtml(z.name)}" required></label>
      <label>Length (ft)<input type="number" name="length_ft" min="0" step="any" value="${z.length_ft ?? ''}" required></label>
      <label>Width (ft)<input type="number" name="width_ft" min="0" step="any" value="${z.width_ft ?? ''}" required></label>
      <label>Height (ft)<input type="number" name="height_ft" min="0" step="any" value="${z.height_ft ?? ''}" required></label>
      <label>Wall support<select name="wall_support">${WALL_OPTIONS
        .map(w => `<option value="${w.value}"${Number(z.wall_support) === w.value ? ' selected' : ''}>${escapeHtml(w.label)}</option>`)
        .join('')}</select></label>
      <label>Notes<input type="text" name="notes" value="${escapeHtml(z.notes || '')}"></label>
      <p class="error" id="edit-error"></p>
      <div class="modal-actions">
        <button type="button" data-action="modal-cancel">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  `);
}

function openVendorEdit(id) {
  const v = state.vendors.find(x => x.id === Number(id));
  if (!v) return;
  showModal('Edit vendor', `
    <form id="edit-form" data-kind="vendor" data-id="${v.id}">
      <label>Name<input type="text" name="name" value="${escapeHtml(v.name)}" required></label>
      <label>Contact<input type="text" name="contact" value="${escapeHtml(v.contact || '')}"></label>
      <label>Notes<input type="text" name="notes" value="${escapeHtml(v.notes || '')}"></label>
      <p class="error" id="edit-error"></p>
      <div class="modal-actions">
        <button type="button" data-action="modal-cancel">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  `);
}

function openLeaseEdit(id) {
  const l = state.leases.find(x => x.id === Number(id));
  if (!l) return;
  showModal('Edit lease', `
    <form id="edit-form" data-kind="lease" data-id="${l.id}">
      <p class="muted-line">${escapeHtml(l.zone_name)} · ${escapeHtml(l.vendor_name)}</p>
      <label>Rate per day<input type="number" name="daily_rate" min="0" step="any" value="${l.daily_rate}" required></label>
      <label>Start date<input type="date" name="start_date" value="${l.start_date}" required></label>
      <label>End date (leave blank to keep it active)<input type="date" name="end_date" value="${l.end_date || ''}"></label>
      <p class="error" id="edit-error"></p>
      <div class="modal-actions">
        <button type="button" data-action="modal-cancel">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  `);
}

// ---- Shared ----
async function refreshAll() {
  await Promise.all([loadZones(), loadVendors(), loadLeases()]);
  await loadDashboard();
  refreshRateHint();
  renderCalcResults();
  renderPlan();
}

async function submitForm(form, errorEl, request) {
  if (errorEl) errorEl.textContent = '';
  try {
    await request();
    return true;
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message;
    else toast(err.message, 'err');
    return false;
  }
}

// ---- Actions dispatched from clicks anywhere in the page ----
const actions = {
  async seed() {
    if (!confirm('Replace everything currently in the app with the sample warehouse?')) return;
    await api('/api/demo/seed', { method: 'POST' });
    await refreshAll();
    toast('Sample data loaded');
  },

  async reset() {
    if (!confirm('Delete all zones, vendors, leases and payments? This cannot be undone.')) return;
    await api('/api/demo/reset', { method: 'POST' });
    closeModal();
    await refreshAll();
    toast('All data cleared');
  },

  'lease-detail': id => openLeaseDetail(id),
  'zone-edit': id => openZoneEdit(id),
  'vendor-edit': id => openVendorEdit(id),
  'lease-edit': id => openLeaseEdit(id),
  'modal-cancel': () => closeModal(),

  async 'plan-place'(id) {
    const zone = state.zones.find(z => z.id === Number(id));
    const { w, h } = planFootprint(zone);
    const spot = findFreeSpot(w, h, planRects());
    zone.pos_x = spot.x;
    zone.pos_y = spot.y;
    selectedSpaceId = zone.id;
    renderPlan();
    await savePosition(zone);
  },

  async 'plan-arrange'() {
    const unplaced = state.zones.filter(z => !isPlaced(z) && Number(z.length_ft) > 0 && Number(z.width_ft) > 0);
    if (!unplaced.length) {
      toast('Every measured space is already on the plan');
      return;
    }
    for (const zone of unplaced) {
      const { w, h } = planFootprint(zone);
      const spot = findFreeSpot(w, h, planRects());
      zone.pos_x = spot.x;
      zone.pos_y = spot.y;
      await savePosition(zone);
    }
    renderPlan();
    toast(`Placed ${unplaced.length} space${unplaced.length === 1 ? '' : 's'}`);
  },

  async 'plan-rotate'(id) {
    const zone = state.zones.find(z => z.id === Number(id));
    zone.rotated = zone.rotated ? 0 : 1;
    renderPlan();
    await savePosition(zone);
  },

  async 'plan-unplace'(id) {
    const zone = state.zones.find(z => z.id === Number(id));
    zone.pos_x = null;
    zone.pos_y = null;
    selectedSpaceId = null;
    renderPlan();
    await savePosition(zone);
  },

  'apply-max-stack'(maxStack) {
    $('#calc-form').stack.value = maxStack;
    renderCalcResults();
  },

  async 'zone-delete'(id) {
    const z = state.zones.find(x => x.id === Number(id));
    if (!confirm(`Delete zone "${z?.name ?? id}"?`)) return;
    await api(`/api/zones/${id}`, { method: 'DELETE' });
    await refreshAll();
    toast('Zone deleted');
  },

  async 'vendor-delete'(id) {
    const v = state.vendors.find(x => x.id === Number(id));
    if (!confirm(`Delete vendor "${v?.name ?? id}"?`)) return;
    await api(`/api/vendors/${id}`, { method: 'DELETE' });
    await refreshAll();
    toast('Vendor deleted');
  },

  async 'lease-delete'(id) {
    if (!confirm('Delete this lease and every payment recorded against it?')) return;
    await api(`/api/leases/${id}`, { method: 'DELETE' });
    closeModal();
    await refreshAll();
    toast('Lease deleted');
  },

  async 'lease-end'(id) {
    if (!confirm('End this lease as of today?')) return;
    await api(`/api/leases/${id}/end`, { method: 'POST', body: JSON.stringify({}) });
    await refreshAll();
    await openLeaseDetail(id);
    toast('Lease ended');
  },

  async 'lease-reopen'(id) {
    await api(`/api/leases/${id}`, { method: 'PATCH', body: JSON.stringify({ end_date: null }) });
    await refreshAll();
    await openLeaseDetail(id);
    toast('Lease reopened');
  },

  async 'payment-delete'(id) {
    if (!confirm('Remove this payment?')) return;
    await api(`/api/payments/${id}`, { method: 'DELETE' });
    const leaseId = openLeaseId;
    await refreshAll();
    if (leaseId) await openLeaseDetail(leaseId);
    toast('Payment removed');
  },
};

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const handler = actions[btn.dataset.action];
  if (!handler) return;
  e.preventDefault();
  try {
    await handler(btn.dataset.id);
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.addEventListener('submit', async e => {
  const form = e.target;

  if (form.id === 'detail-payment-form') {
    e.preventDefault();
    const leaseId = openLeaseId;
    const ok = await submitForm(form, $('#detail-error'), () =>
      api(`/api/leases/${leaseId}/payments`, { method: 'POST', body: JSON.stringify(formToObject(form)) }));
    if (ok) {
      await refreshAll();
      await openLeaseDetail(leaseId);
      toast('Payment recorded');
    }
    return;
  }

  if (form.id === 'edit-form') {
    e.preventDefault();
    const { kind, id } = form.dataset;
    const path = { zone: 'zones', vendor: 'vendors', lease: 'leases' }[kind];
    const ok = await submitForm(form, $('#edit-error'), () =>
      api(`/api/${path}/${id}`, { method: 'PATCH', body: JSON.stringify(formToObject(form)) }));
    if (ok) {
      closeModal();
      await refreshAll();
      toast('Saved');
    }
    return;
  }
});

// ---- Space picker ----
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
const ITEM_PRESETS = [
  { id: 'carton-lg', label: 'Carton, large (600 × 400 × 400 mm)', l: 0.6, w: 0.4, h: 0.4 },
  { id: 'carton-sm', label: 'Carton, small (400 × 300 × 300 mm)', l: 0.4, w: 0.3, h: 0.3 },
  { id: 'bag', label: 'Sack or bag, 50 kg (900 × 550 × 250 mm)', l: 0.9, w: 0.55, h: 0.25 },
  { id: 'bale', label: 'Pressed bale (1100 × 550 × 700 mm)', l: 1.1, w: 0.55, h: 0.7 },
  { id: 'pallet-std', label: 'Pallet, loaded (1200 × 1000 × 1200 mm)', l: 1.2, w: 1.0, h: 1.2 },
  { id: 'drum', label: 'Drum, 200 litre (ø 580 × 890 mm)', l: 0.58, w: 0.58, h: 0.89 },
  { id: 'custom', label: 'Something else — I’ll type the size', l: null, w: null, h: null },
];

function sqft(n) {
  return Number(n).toLocaleString(LOCALE, { maximumFractionDigits: n < 100 ? 1 : 0 });
}

function whole(n) {
  return Math.round(Number(n)).toLocaleString(LOCALE);
}

function calcInputs() {
  return Object.fromEntries(new FormData($('#calc-form')).entries());
}

function itemFromInputs(d) {
  const toFt = d.dim_unit === 'm' ? M_TO_FT : 1;
  const l = Number(d.item_l) * toFt;
  const w = Number(d.item_w) * toFt;
  const h = Number(d.item_h) * toFt;
  const qty = Math.floor(Number(d.quantity) || 0);
  if (!(l > 0 && w > 0 && h > 0 && qty > 0)) return null;

  const cap = Math.floor(Number(d.max_stack) || 0);
  return { l, w, h, qty, footprint: l * w, maxStack: cap > 0 ? cap : null };
}

function spaceCapacity(zone, item) {
  const wall = wallInfo(zone.wall_support);
  const floorSqft = Number(zone.size_sqft) || 0;
  const usableFloor = floorSqft * wall.usable;
  const usableHeight = Math.max(Number(zone.height_ft) - HEADROOM_FT, 0);

  let layers = Math.floor(usableHeight / item.h);
  const limitedByRule = item.maxStack !== null && item.maxStack < layers;
  if (limitedByRule) layers = item.maxStack;
  layers = Math.max(layers, 0);

  const perLayer = Math.floor(usableFloor / item.footprint);
  return { wall, floorSqft, usableFloor, usableHeight, layers, perLayer, limitedByRule, capacity: perLayer * layers };
}

function averageRatePerSqft() {
  const sizes = new Map(state.zones.map(z => [z.id, z.size_sqft]));
  const active = state.leases.filter(l => !l.end_date && sizes.get(l.zone_id) > 0);
  if (!active.length) return null;
  return active.reduce((sum, l) => sum + l.daily_rate / sizes.get(l.zone_id), 0) / active.length;
}

function capacityRow(r, item) {
  const z = r.zone;
  const fits = r.capacity >= item.qty;
  const occupied = !!z.active_lease_id;
  const status = occupied
    ? `taken — ${escapeHtml(z.vendor_name)}`
    : 'vacant';

  const verdict = r.capacity === 0
    ? 'Too low for even one layer'
    : fits
      ? `Holds about ${whole(r.capacity)} — room for ${whole(r.capacity - item.qty)} more`
      : `Holds about ${whole(r.capacity)} — ${whole(item.qty - r.capacity)} short`;

  return `<li class="${fits && !occupied ? 'fit-yes' : occupied ? 'fit-taken' : 'fit-no'}">
      <div class="fit-head">
        <span class="fit-name">${escapeHtml(z.name)}</span>
        <span class="fit-verdict">${verdict}</span>
      </div>
      <div class="fit-meta">
        ${z.length_ft} × ${z.width_ft} × ${z.height_ft} ft · ${r.wall.short} · ${status}
      </div>
      <div class="fit-working">
        ${sqft(r.usableFloor)} sq ft usable (${Math.round(r.wall.usable * 100)}% of ${sqft(r.floorSqft)})
        ÷ ${sqft(item.footprint)} sq ft = ${whole(r.perLayer)} per layer,
        ${whole(r.layers)} layer${r.layers === 1 ? '' : 's'} high${r.limitedByRule ? ' (your limit)' : ` in ${sqft(r.usableHeight)} ft usable height`}
      </div>
    </li>`;
}

function renderCalcResults() {
  const box = $('#calc-results');
  const d = calcInputs();
  const item = itemFromInputs(d);

  if (!item) {
    box.innerHTML = '<p class="muted-line">Enter how many you have and the size of one of them.</p>';
    return;
  }

  const measured = state.zones.filter(z => Number(z.size_sqft) > 0 && Number(z.height_ft) > 0);
  if (!measured.length) {
    box.innerHTML = '<p class="muted-line">No spaces with dimensions recorded yet. Add one on the Spaces tab.</p>';
    return;
  }

  const rows = measured.map(z => ({ zone: z, ...spaceCapacity(z, item) }));
  const vacant = rows.filter(r => !r.zone.active_lease_id);

  // Among spaces that fit, the best one wastes the least rentable floor — not the least
  // capacity, since floor area is what gets charged for.
  const fitting = vacant.filter(r => r.capacity >= item.qty).sort((a, b) => a.floorSqft - b.floorSqft);
  const best = fitting[0] || null;
  const biggest = [...vacant].sort((a, b) => b.capacity - a.capacity)[0] || null;

  const rate = Number(d.rate_sqft) || 0;
  let headline;
  if (best) {
    const rent = rate > 0
      ? `<div class="headline-rent">At ${money(rate)} per sq ft per day that space is
         ${money(Math.round(best.floorSqft * rate))} / day ·
         ${money(Math.round(best.floorSqft * rate * 30))} per 30 days</div>`
      : '';
    headline = `
      <div class="result-headline">
        <div class="result-value">${escapeHtml(best.zone.name)}</div>
        <div class="result-sub">
          smallest vacant space that takes all ${whole(item.qty)} —
          holds about ${whole(best.capacity)}
          ${fitting.length > 1 ? `· ${fitting.length} vacant spaces would do` : ''}
        </div>
        ${rent}
      </div>`;
  } else if (biggest) {
    headline = `
      <div class="result-headline no-fit">
        <div class="result-value">Nothing vacant takes all ${whole(item.qty)}</div>
        <div class="result-sub">
          The roomiest vacant space, ${escapeHtml(biggest.zone.name)}, holds about
          ${whole(biggest.capacity)}. Split the load across spaces, or stack higher if the goods allow.
        </div>
      </div>`;
  } else {
    headline = `
      <div class="result-headline no-fit">
        <div class="result-value">Everything is let right now</div>
        <div class="result-sub">No vacant spaces to compare against.</div>
      </div>`;
  }

  const ordered = [
    ...fitting,
    ...vacant.filter(r => r.capacity < item.qty).sort((a, b) => b.capacity - a.capacity),
    ...rows.filter(r => r.zone.active_lease_id).sort((a, b) => b.capacity - a.capacity),
  ];

  box.innerHTML = `
    ${headline}
    <h4>Every space, measured against this load</h4>
    <ul class="fit-list">${ordered.map(r => capacityRow(r, item)).join('')}</ul>
    <p class="muted-line footnote">
      Counts are approximate: usable floor is divided by the footprint of one item, so it
      assumes goods pack reasonably tightly. ${HEADROOM_FT} ft is left as headroom under
      the ceiling in every space.
    </p>
  `;
}

function applyPreset() {
  const preset = ITEM_PRESETS.find(p => p.id === $('#calc-preset').value);
  if (!preset || preset.id === 'custom') return;
  const form = $('#calc-form');
  form.dim_unit.value = 'm';
  form.item_l.value = preset.l;
  form.item_w.value = preset.w;
  form.item_h.value = preset.h;
}

function refreshRateHint() {
  const avg = averageRatePerSqft();
  const hint = $('#rate-hint');
  const input = $('#calc-form').rate_sqft;
  if (avg) {
    hint.textContent = `₹ per sq ft per day · your active leases average ${avg.toFixed(2)}`;
    if (!input.value) input.value = avg.toFixed(2);
  } else {
    hint.textContent = '₹ per sq ft per day';
  }
}

function initCalculator() {
  $('#calc-preset').innerHTML = ITEM_PRESETS
    .map(p => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  $('#zone-wall-select').innerHTML = WALL_OPTIONS
    .map(w => `<option value="${w.value}">${escapeHtml(w.label)}</option>`).join('');
  applyPreset();

  // Only 'input' — a 'change' listener here would re-render on blur, destroying any
  // result button mid-click before the browser can synthesise the click event.
  $('#calc-form').addEventListener('input', e => {
    if (e.target.name === 'preset') applyPreset();
    if (['item_l', 'item_w', 'item_h'].includes(e.target.name)) {
      $('#calc-preset').value = 'custom';
    }
    renderCalcResults();
  });

  $('#calc-form').addEventListener('submit', e => e.preventDefault());
}
// ---- Floor plan ----
const PLAN_PAD_FT = 6;
const PLAN_MIN_W = 60;
const PLAN_MIN_H = 40;
const SNAP_FT = 1;

let selectedSpaceId = null;
let dragState = null;

function isPlaced(z) {
  return z.pos_x != null && z.pos_y != null && Number(z.length_ft) > 0 && Number(z.width_ft) > 0;
}

// A rotated space runs the other way round on the plan; its recorded dimensions don't change.
function planFootprint(z) {
  return z.rotated
    ? { w: Number(z.width_ft), h: Number(z.length_ft) }
    : { w: Number(z.length_ft), h: Number(z.width_ft) };
}

// SVG won't wrap or clip text, so trim it to what the box can hold. Roughly 0.55 em
// per character is close enough for the sans-serif stack in use.
function fitText(str, boxWidthFt, fontSizeFt) {
  const maxChars = Math.floor((boxWidthFt * 0.88) / (fontSizeFt * 0.55));
  if (str.length <= maxChars) return str;
  return maxChars <= 1 ? '' : `${str.slice(0, maxChars - 1)}…`;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function planRects() {
  return state.zones.filter(isPlaced).map(z => {
    const { w, h } = planFootprint(z);
    return { zone: z, id: z.id, x: Number(z.pos_x), y: Number(z.pos_y), w, h };
  });
}

function findFreeSpot(w, h, occupied) {
  const limitX = Math.max(PLAN_MIN_W, ...occupied.map(o => o.x + o.w), 0);
  const limitY = Math.max(PLAN_MIN_H, ...occupied.map(o => o.y + o.h), 0) + h + 10;
  for (let y = 0; y <= limitY; y += 1) {
    for (let x = 0; x + w <= limitX + w; x += 1) {
      const candidate = { x, y, w, h };
      if (!occupied.some(o => rectsOverlap(candidate, o))) return { x, y };
    }
  }
  return { x: 0, y: limitY };
}

function svgPoint(evt) {
  const svg = $('#plan-canvas');
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
}

function renderPlan() {
  const svg = $('#plan-canvas');
  if (!svg) return;

  const rects = planRects();
  const extentX = Math.max(PLAN_MIN_W, ...rects.map(r => r.x + r.w)) + PLAN_PAD_FT;
  const extentY = Math.max(PLAN_MIN_H, ...rects.map(r => r.y + r.h)) + PLAN_PAD_FT;
  svg.setAttribute('viewBox', `0 0 ${extentX} ${extentY}`);
  svg.style.aspectRatio = `${extentX} / ${extentY}`;

  let grid = '';
  for (let x = 0; x <= extentX; x += 5) grid += `M${x} 0 V${extentY} `;
  for (let y = 0; y <= extentY; y += 5) grid += `M0 ${y} H${extentX} `;

  // Labels are sized in screen pixels converted back into plan feet, so they stay
  // readable on a phone instead of shrinking with the drawing.
  const renderedWidth = svg.getBoundingClientRect().width;
  const pxPerFt = renderedWidth > 0 ? renderedWidth / extentX : 12;
  const ft = px => px / pxPerFt;

  const shapes = rects.map(r => {
    const z = r.zone;
    const overlapping = rects.some(o => o.id !== r.id && rectsOverlap(r, o));
    const taken = !!z.active_lease_id;
    const fontSize = Math.min(ft(15), Math.min(r.w, r.h) * 0.2);
    const roomy = r.h >= fontSize * 4.2 && r.w >= fontSize * 5;

    const classes = ['plan-space', taken ? 'taken' : 'vacant'];
    if (overlapping) classes.push('overlap');
    if (selectedSpaceId === z.id) classes.push('selected');

    const subSize = fontSize * 0.72;
    const lines = [
      `<text class="plan-name" x="${r.w / 2}" y="${roomy ? r.h / 2 - fontSize * 0.5 : r.h / 2 + fontSize * 0.35}" font-size="${fontSize}">${escapeHtml(fitText(z.name, r.w, fontSize))}</text>`,
    ];
    if (roomy) {
      lines.push(`<text class="plan-sub" x="${r.w / 2}" y="${r.h / 2 + fontSize * 0.8}" font-size="${subSize}">${fitText(`${r.w} × ${r.h} ft`, r.w, subSize)}</text>`);
      lines.push(`<text class="plan-sub" x="${r.w / 2}" y="${r.h / 2 + fontSize * 2}" font-size="${subSize}">${escapeHtml(fitText(taken ? z.vendor_name : 'Vacant', r.w, subSize))}</text>`);
    }

    return `<g class="${classes.join(' ')}" data-plan-id="${z.id}" transform="translate(${r.x} ${r.y})">
        <rect width="${r.w}" height="${r.h}" rx="0.4"></rect>
        ${lines.join('')}
      </g>`;
  }).join('');

  svg.innerHTML = `<path class="plan-grid" d="${grid}"></path>${shapes}`;
  renderPlanSelection();
  renderPlanTray();
}

function renderPlanSelection() {
  const box = $('#plan-selection');
  const z = state.zones.find(s => s.id === selectedSpaceId);
  if (!z || !isPlaced(z)) {
    box.innerHTML = '';
    return;
  }
  const { w, h } = planFootprint(z);
  box.innerHTML = `
    <div class="plan-selected">
      <div>
        <strong>${escapeHtml(z.name)}</strong>
        <span class="muted-inline">${w} × ${h} ft on the plan ·
          ${z.active_lease_id ? `taken by ${escapeHtml(z.vendor_name)}` : 'vacant'}</span>
      </div>
      <div class="plan-selected-actions">
        <button data-action="plan-rotate" data-id="${z.id}">Rotate 90°</button>
        ${z.active_lease_id ? `<button data-action="lease-detail" data-id="${z.active_lease_id}">View lease</button>` : ''}
        <button data-action="plan-unplace" data-id="${z.id}">Take off plan</button>
      </div>
    </div>`;
}

function renderPlanTray() {
  const tray = $('#plan-tray');
  const unplaced = state.zones.filter(z => !isPlaced(z));
  if (!unplaced.length) {
    tray.innerHTML = '';
    return;
  }
  tray.innerHTML = `
    <h4>Not on the plan yet</h4>
    <div class="tray-items">
      ${unplaced.map(z => {
        const measured = Number(z.length_ft) > 0 && Number(z.width_ft) > 0;
        return `<div class="tray-item">
          <span>${escapeHtml(z.name)}</span>
          <span class="muted-inline">${measured ? `${z.length_ft} × ${z.width_ft} ft` : 'no dimensions recorded'}</span>
          ${measured ? `<button data-action="plan-place" data-id="${z.id}">Place</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

async function savePosition(zone) {
  try {
    await api(`/api/zones/${zone.id}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ pos_x: zone.pos_x, pos_y: zone.pos_y, rotated: zone.rotated }),
    });
  } catch (err) {
    toast(err.message, 'err');
    await refreshAll();
  }
}

function onPlanPointerDown(e) {
  const g = e.target.closest('.plan-space');
  if (!g) {
    if (selectedSpaceId !== null) {
      selectedSpaceId = null;
      renderPlan();
    }
    return;
  }

  const zone = state.zones.find(z => z.id === Number(g.dataset.planId));
  if (!zone) return;

  const p = svgPoint(e);
  dragState = {
    id: zone.id,
    moved: false,
    offsetX: p.x - Number(zone.pos_x),
    offsetY: p.y - Number(zone.pos_y),
    x: Number(zone.pos_x),
    y: Number(zone.pos_y),
  };
  g.setPointerCapture(e.pointerId);
  g.classList.add('dragging');
  e.preventDefault();
}

function onPlanPointerMove(e) {
  if (!dragState) return;
  const p = svgPoint(e);
  const nx = Math.max(0, Math.round((p.x - dragState.offsetX) / SNAP_FT) * SNAP_FT);
  const ny = Math.max(0, Math.round((p.y - dragState.offsetY) / SNAP_FT) * SNAP_FT);
  if (nx !== dragState.x || ny !== dragState.y) dragState.moved = true;
  dragState.x = nx;
  dragState.y = ny;
  const g = document.querySelector(`.plan-space[data-plan-id="${dragState.id}"]`);
  if (g) g.setAttribute('transform', `translate(${nx} ${ny})`);
}

async function onPlanPointerUp() {
  if (!dragState) return;
  const drag = dragState;
  dragState = null;

  const zone = state.zones.find(z => z.id === drag.id);
  if (!zone) return;

  if (!drag.moved) {
    selectedSpaceId = selectedSpaceId === drag.id ? null : drag.id;
    renderPlan();
    return;
  }

  zone.pos_x = drag.x;
  zone.pos_y = drag.y;
  selectedSpaceId = drag.id;
  renderPlan();
  await savePosition(zone);
}

function initPlan() {
  const svg = $('#plan-canvas');
  svg.addEventListener('pointerdown', onPlanPointerDown);
  svg.addEventListener('pointermove', onPlanPointerMove);
  svg.addEventListener('pointerup', onPlanPointerUp);
  svg.addEventListener('pointercancel', onPlanPointerUp);
}

// ---- Wiring ----
document.addEventListener('DOMContentLoaded', () => {
  $all('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach(b => b.classList.remove('active'));
      $all('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#${btn.dataset.tab}`).classList.add('active');
      // The plan sizes its labels from the rendered width, which is zero while hidden.
      if (btn.dataset.tab === 'plan') renderPlan();
    });
  });

  window.addEventListener('resize', () => {
    if ($('#plan').classList.contains('active')) renderPlan();
  });

  $('#lease-form').start_date.value = todayStr();
  initCalculator();
  initPlan();
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  $('#zone-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const ok = await submitForm(form, $('#zone-error'), () =>
      api('/api/zones', { method: 'POST', body: JSON.stringify(formToObject(form)) }));
    if (ok) { form.reset(); await refreshAll(); toast('Zone added'); }
  });

  $('#vendor-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const ok = await submitForm(form, $('#vendor-error'), () =>
      api('/api/vendors', { method: 'POST', body: JSON.stringify(formToObject(form)) }));
    if (ok) { form.reset(); await refreshAll(); toast('Vendor added'); }
  });

  $('#lease-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const ok = await submitForm(form, $('#lease-error'), () =>
      api('/api/leases', { method: 'POST', body: JSON.stringify(formToObject(form)) }));
    if (ok) {
      form.reset();
      form.start_date.value = todayStr();
      await refreshAll();
      toast('Lease created');
    }
  });

  refreshAll();
});
