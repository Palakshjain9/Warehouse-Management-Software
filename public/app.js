const CURRENCY = '₹';
const LOCALE = 'en-IN';

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = { zones: [], vendors: [], leases: [], bookings: [] };
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No spaces yet. Add one above.</td></tr>';
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
      <td data-label="Rate/day">${z.list_rate_per_day ? money(z.list_rate_per_day) : '\u2014'}</td>
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

// ---- Bookings from the customer page ----
async function loadBookings() {
  state.bookings = await api('/api/bookings');
  const tbody = $('#bookings-table tbody');
  if (!state.bookings.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No enquiries from the booking page yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.bookings.map(b => `<tr>
    <td data-label="When">${fmtDate((b.created_at || '').slice(0, 10))}</td>
    <td data-label="Space">${escapeHtml(b.zone_name)}</td>
    <td data-label="Customer">
      ${escapeHtml(b.customer_name)}
      ${b.contact ? `<div class="cell-note">${escapeHtml(b.contact)}</div>` : ''}
    </td>
    <td data-label="Wants to store">
      ${b.quantity ? `${Number(b.quantity).toLocaleString(LOCALE)} \u00d7 ${escapeHtml(b.item_label || 'items')}` : '\u2014'}
    </td>
    <td data-label="From">${b.start_date ? fmtDate(b.start_date) : '\u2014'}</td>
    <td data-label="Fit">${b.fit_warning
      ? `<span class="badge occupied">${escapeHtml(b.fit_warning)}</span>`
      : '<span class="badge vacant">Looked fine</span>'}</td>
    <td data-label="" class="row-actions">
      <button data-action="booking-delete" data-id="${b.id}" class="danger-text">Delete</button>
    </td>
  </tr>`).join('');
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
      <label>Rate per day<input type="number" name="list_rate_per_day" min="0" step="any" value="${z.list_rate_per_day ?? ''}"></label>
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
  await Promise.all([loadZones(), loadVendors(), loadLeases(), loadBookings()]);
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

  'map-start'(id) {
    mappingZoneId = Number(id);
    selectedHotspotId = null;
    renderPlan();
  },

  'map-cancel'() {
    mappingZoneId = null;
    renderPlan();
  },

  async 'map-clear'(id) {
    await api(`/api/zones/${id}/hotspot`, { method: 'PATCH', body: JSON.stringify({ hot_x: null }) });
    if (selectedHotspotId === Number(id)) selectedHotspotId = null;
    await refreshAll();
    toast('Area cleared');
  },

  async 'plan-remove-image'() {
    if (!confirm('Remove the drawing? Every marked area is cleared with it.')) return;
    await api('/api/plan/image', { method: 'DELETE' });
    mappingZoneId = null;
    selectedHotspotId = null;
    await loadPlanImage();
    await refreshAll();
    toast('Drawing removed');
  },

  async 'booking-delete'(id) {
    if (!confirm('Delete this enquiry?')) return;
    await api(`/api/bookings/${id}`, { method: 'DELETE' });
    await refreshAll();
    toast('Enquiry deleted');
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
// Wall factors, item presets and capacity maths live in fit.js, shared with /book.

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
  return makeItem({
    l: d.item_l, w: d.item_w, h: d.item_h, unit: d.dim_unit,
    quantity: d.quantity, maxStack: d.max_stack,
  });
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
// ---- Plan drawing and hotspot mapping ----
// The drawing is the owner's own layout image. Hotspots are rectangles drawn over it,
// stored as fractions of the image so they hold up at any display size.

let planImage = null;
let mappingZoneId = null;
let hotspotDraw = null;
let selectedHotspotId = null;

async function loadPlanImage() {
  const row = await api('/api/plan/image');
  planImage = row.data_url || null;
  renderPlan();
}

function hotspotOf(z) {
  return z.hot_w != null && z.hot_h != null
    ? { x: Number(z.hot_x), y: Number(z.hot_y), w: Number(z.hot_w), h: Number(z.hot_h) }
    : null;
}

function renderPlan() {
  const wrap = $('#plan-stage');
  if (!wrap) return;

  if (!planImage) {
    wrap.innerHTML = `
      <div class="empty-state">
        <h2>No layout drawing yet</h2>
        <p>Upload a picture of your basement layout with the spaces marked and named.
           You then draw a box over each one to make it tappable for customers.</p>
        <label class="primary file-button">
          Choose a drawing<input type="file" id="plan-file" accept="image/png,image/jpeg,image/webp" hidden>
        </label>
      </div>`;
    $('#plan-tools').innerHTML = '';
    $('#plan-list').innerHTML = '';
    return;
  }

  const mapped = state.zones.filter(z => hotspotOf(z));
  const boxes = mapped.map(z => {
    const h = hotspotOf(z);
    const classes = ['hot-box'];
    if (mappingZoneId === z.id) classes.push('mapping-target');
    if (selectedHotspotId === z.id) classes.push('selected');
    return `<div class="${classes.join(' ')}" data-hot-id="${z.id}"
        style="left:${h.x * 100}%;top:${h.y * 100}%;width:${h.w * 100}%;height:${h.h * 100}%">
        <span>${escapeHtml(z.name)}</span>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div id="plan-frame" class="${mappingZoneId ? 'drawing' : ''}">
      <img id="plan-img" src="${planImage}" alt="Basement layout">
      ${boxes}
      <div id="draw-box" class="hidden"></div>
    </div>`;

  $('#plan-tools').innerHTML = `
    <label class="file-button">Replace drawing<input type="file" id="plan-file" accept="image/png,image/jpeg,image/webp" hidden></label>
    <button data-action="plan-remove-image" class="danger-text">Remove drawing</button>
    <a class="link-button" href="/book" target="_blank">Open customer view</a>`;

  renderPlanList();
}

function renderPlanList() {
  const list = $('#plan-list');
  if (!planImage) { list.innerHTML = ''; return; }

  const rows = state.zones.map(z => {
    const mapped = !!hotspotOf(z);
    return `<li class="${mapped ? 'mapped' : 'unmapped'}">
      <span class="fit-name">${escapeHtml(z.name)}</span>
      <span class="muted-inline">${z.size_sqft ? `${Number(z.size_sqft).toLocaleString(LOCALE)} sq ft` : ''}
        ${z.height_ft ? `· ${z.height_ft} ft high` : ''}</span>
      <span class="map-actions">
        ${mappingZoneId === z.id
          ? `<em>Drag a box on the drawing…</em> <button data-action="map-cancel">Cancel</button>`
          : `<button data-action="map-start" data-id="${z.id}">${mapped ? 'Redraw area' : 'Mark area'}</button>`}
        ${mapped ? `<button data-action="map-clear" data-id="${z.id}" class="danger-text">Clear</button>` : ''}
      </span>
    </li>`;
  }).join('');

  const unmappedCount = state.zones.filter(z => !hotspotOf(z)).length;
  list.innerHTML = `
    <h4>Spaces on the drawing</h4>
    ${unmappedCount ? `<p class="muted-line">${unmappedCount} space${unmappedCount === 1 ? '' : 's'}
      not marked yet — customers can only pick the ones you mark.</p>` : ''}
    <ul class="map-list">${rows}</ul>`;
}

async function uploadPlanFile(file) {
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) {
    toast('That image is over 6 MB — try a smaller one', 'err');
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });

  try {
    await api('/api/plan/image', { method: 'PUT', body: JSON.stringify({ data_url: dataUrl }) });
    await loadPlanImage();
    toast('Drawing uploaded');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function frameFraction(evt) {
  const frame = $('#plan-frame');
  const r = frame.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (evt.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (evt.clientY - r.top) / r.height)),
  };
}

function onPlanStagePointerDown(e) {
  if (!planImage) return;

  if (!mappingZoneId) {
    const box = e.target.closest('.hot-box');
    selectedHotspotId = box ? Number(box.dataset.hotId) : null;
    renderPlan();
    return;
  }

  const start = frameFraction(e);
  hotspotDraw = { ...start, x2: start.x, y2: start.y };
  const draw = $('#draw-box');
  draw.classList.remove('hidden');
  $('#plan-frame').setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPlanStagePointerMove(e) {
  if (!hotspotDraw) return;
  const p = frameFraction(e);
  hotspotDraw.x2 = p.x;
  hotspotDraw.y2 = p.y;

  const draw = $('#draw-box');
  const left = Math.min(hotspotDraw.x, hotspotDraw.x2);
  const top = Math.min(hotspotDraw.y, hotspotDraw.y2);
  draw.style.left = `${left * 100}%`;
  draw.style.top = `${top * 100}%`;
  draw.style.width = `${Math.abs(hotspotDraw.x2 - hotspotDraw.x) * 100}%`;
  draw.style.height = `${Math.abs(hotspotDraw.y2 - hotspotDraw.y) * 100}%`;
}

async function onPlanStagePointerUp() {
  if (!hotspotDraw) return;
  const drawn = hotspotDraw;
  hotspotDraw = null;
  $('#draw-box').classList.add('hidden');

  const zoneId = mappingZoneId;
  const payload = {
    hot_x: Math.min(drawn.x, drawn.x2),
    hot_y: Math.min(drawn.y, drawn.y2),
    hot_w: Math.abs(drawn.x2 - drawn.x),
    hot_h: Math.abs(drawn.y2 - drawn.y),
  };

  try {
    await api(`/api/zones/${zoneId}/hotspot`, { method: 'PATCH', body: JSON.stringify(payload) });
    mappingZoneId = null;
    selectedHotspotId = zoneId;
    await refreshAll();
    toast('Area marked');
  } catch (err) {
    toast(err.message, 'err');
    renderPlan();
  }
}

function initPlan() {
  const stage = $('#plan-stage');
  stage.addEventListener('pointerdown', onPlanStagePointerDown);
  stage.addEventListener('pointermove', onPlanStagePointerMove);
  stage.addEventListener('pointerup', onPlanStagePointerUp);
  stage.addEventListener('pointercancel', onPlanStagePointerUp);

  document.addEventListener('change', e => {
    if (e.target.id === 'plan-file') uploadPlanFile(e.target.files[0]);
  });
}
// ---- Wiring ----
document.addEventListener('DOMContentLoaded', () => {
  $all('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach(b => b.classList.remove('active'));
      $all('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'plan') renderPlan();
    });
  });

  $('#lease-form').start_date.value = todayStr();
  initCalculator();
  initPlan();
  loadPlanImage();
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
