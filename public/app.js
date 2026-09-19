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
      <td data-label="Zone">${escapeHtml(l.zone_name)}</td>
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No zones yet. Add one above.</td></tr>';
  } else {
    tbody.innerHTML = state.zones.map(z => `<tr>
      <td data-label="Name">${escapeHtml(z.name)}</td>
      <td data-label="Size">${z.size_sqft == null ? '—' : Number(z.size_sqft).toLocaleString(LOCALE)}</td>
      <td data-label="Status">${z.active_lease_id
        ? `<span class="badge occupied">Occupied — ${escapeHtml(z.vendor_name)}</span>`
        : '<span class="badge vacant">Vacant</span>'}</td>
      <td data-label="Notes">${escapeHtml(z.notes || '')}</td>
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
    : '<option value="">No vacant zones</option>';
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
      <td data-label="Zone">${escapeHtml(l.zone_name)}</td>
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
  showModal('Edit zone', `
    <form id="edit-form" data-kind="zone" data-id="${z.id}">
      <label>Name<input type="text" name="name" value="${escapeHtml(z.name)}" required></label>
      <label>Size (sq ft)<input type="number" name="size_sqft" min="0" step="any" value="${z.size_sqft ?? ''}"></label>
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

// ---- Space calculator ----
const M_TO_FT = 3.280839895;
const CBM_TO_CUFT = 35.3146667;

// Starting points only — every dimension stays editable, because real stock varies.
const ITEM_PRESETS = [
  { id: 'pallet-std', label: 'Pallet, standard (1200 × 1000 mm)', l: 1.2, w: 1.0, h: 1.2 },
  { id: 'pallet-euro', label: 'Pallet, euro (1200 × 800 mm)', l: 1.2, w: 0.8, h: 1.2 },
  { id: 'bale', label: 'Pressed bale (1100 × 550 mm)', l: 1.1, w: 0.55, h: 0.7 },
  { id: 'carton-lg', label: 'Carton, large (600 × 400 mm)', l: 0.6, w: 0.4, h: 0.4 },
  { id: 'carton-sm', label: 'Carton, small (400 × 300 mm)', l: 0.4, w: 0.3, h: 0.3 },
  { id: 'drum', label: 'Drum, 200 litre (ø 580 mm)', l: 0.58, w: 0.58, h: 0.89 },
  { id: 'custom', label: 'Something else — I’ll type the size', l: null, w: null, h: null },
];

function sqft(n) {
  return Number(n).toLocaleString(LOCALE, { maximumFractionDigits: n < 100 ? 1 : 0 });
}

function calcInputs() {
  return Object.fromEntries(new FormData($('#calc-form')).entries());
}

function computeEstimate(d) {
  const util = Number(d.utilisation) || 0.7;
  const clearHeight = Number(d.clear_height) || 0;
  let storageSqft;
  let stackHeightFt;
  let detail;

  if (d.mode === 'items') {
    const toFt = d.dim_unit === 'm' ? M_TO_FT : 1;
    const l = Number(d.item_l) * toFt;
    const w = Number(d.item_w) * toFt;
    const h = Number(d.item_h) * toFt;
    const qty = Math.floor(Number(d.quantity) || 0);
    const stack = Math.max(1, Math.floor(Number(d.stack) || 1));
    if (!(l > 0 && w > 0 && h > 0 && qty > 0)) return null;

    const unitFootprint = l * w;
    const positions = Math.ceil(qty / stack);
    storageSqft = positions * unitFootprint;
    stackHeightFt = stack * h;
    detail = {
      qty, stack, positions, unitFootprint, unitHeightFt: h,
      maxStack: clearHeight > 0 ? Math.floor(clearHeight / h) : null,
    };
  } else {
    const cuft = Number(d.volume) * (d.vol_unit === 'cbm' ? CBM_TO_CUFT : 1);
    stackHeightFt = Number(d.vol_stack_ft) || 0;
    if (!(cuft > 0 && stackHeightFt > 0)) return null;
    storageSqft = cuft / stackHeightFt;
    detail = { cuft };
  }

  const totalSqft = storageSqft / util;
  return {
    mode: d.mode,
    util, clearHeight, storageSqft, stackHeightFt, totalSqft,
    aisleSqft: totalSqft - storageSqft,
    heightOk: clearHeight <= 0 || stackHeightFt <= clearHeight,
    rate: Number(d.rate_sqft) || 0,
    ...detail,
  };
}

function averageRatePerSqft() {
  const sizes = new Map(state.zones.map(z => [z.id, z.size_sqft]));
  const active = state.leases.filter(l => !l.end_date && sizes.get(l.zone_id) > 0);
  if (!active.length) return null;
  return active.reduce((sum, l) => sum + l.daily_rate / sizes.get(l.zone_id), 0) / active.length;
}

function matchZones(needed) {
  const vacant = state.zones.filter(z => !z.active_lease_id && Number(z.size_sqft) > 0);
  const fits = vacant.filter(z => z.size_sqft >= needed).sort((a, b) => a.size_sqft - b.size_sqft);
  const short = vacant.filter(z => z.size_sqft < needed).sort((a, b) => b.size_sqft - a.size_sqft);

  let combo = null;
  if (!fits.length && short.length) {
    const picked = [];
    let sum = 0;
    for (const z of short) {
      picked.push(z);
      sum += z.size_sqft;
      if (sum >= needed) break;
    }
    if (sum >= needed) combo = { zones: picked, total: sum };
  }
  return { vacant, fits, short, combo };
}

function renderCalcResults() {
  const box = $('#calc-results');
  const est = computeEstimate(calcInputs());

  if (!est) {
    box.innerHTML = '<p class="muted-line">Fill in a quantity and the size of one item to see an estimate.</p>';
    return;
  }

  const working = est.mode === 'items'
    ? `
      <div class="calc-row"><span>One ${est.stack > 1 ? 'item' : 'item'} takes up</span><span>${sqft(est.unitFootprint)} sq ft of floor</span></div>
      <div class="calc-row"><span>Stacked ${est.stack} high, that needs</span><span>${est.positions.toLocaleString(LOCALE)} floor position${est.positions === 1 ? '' : 's'} <em>= ${est.qty.toLocaleString(LOCALE)} ÷ ${est.stack}, rounded up</em></span></div>
      <div class="calc-row calc-sum"><span>Storage footprint</span><span>${sqft(est.storageSqft)} sq ft <em>= ${est.positions} × ${sqft(est.unitFootprint)}</em></span></div>`
    : `
      <div class="calc-row"><span>Goods volume</span><span>${sqft(est.cuft)} cu ft</span></div>
      <div class="calc-row"><span>Stacked up to</span><span>${est.stackHeightFt} ft high</span></div>
      <div class="calc-row calc-sum"><span>Storage footprint</span><span>${sqft(est.storageSqft)} sq ft <em>= ${sqft(est.cuft)} ÷ ${est.stackHeightFt}</em></span></div>`;

  const heightNote = est.heightOk
    ? `<div class="calc-row"><span>Stack height</span><span>${est.stackHeightFt.toFixed(1)} ft — fits under ${est.clearHeight} ft ✓</span></div>`
    : '';

  const heightWarning = est.heightOk ? '' : `
    <div class="notice warn-notice">
      <strong>That stack is too tall.</strong>
      Stacking ${est.mode === 'items' ? `${est.stack} high at ${est.unitHeightFt.toFixed(1)} ft each` : ''}
      needs ${est.stackHeightFt.toFixed(1)} ft, but the shed is ${est.clearHeight} ft clear.
      ${est.mode === 'items' && est.maxStack >= 1
        ? `You could stack ${est.maxStack} high instead.
           <button data-action="apply-max-stack" data-id="${est.maxStack}">Use ${est.maxStack} high</button>`
        : 'Lower the stack height to fit.'}
    </div>`;

  const rentBlock = est.rate > 0 ? `
    <div class="calc-block">
      <div class="calc-row"><span>At ${money(est.rate)} per sq ft per day</span><span>${money(Math.round(est.totalSqft * est.rate))} / day</span></div>
      <div class="calc-row calc-total"><span>Roughly per 30 days</span><span>${money(Math.round(est.totalSqft * est.rate * 30))}</span></div>
    </div>` : '';

  const { vacant, fits, short, combo } = matchZones(est.totalSqft);

  let zoneBlock;
  if (!vacant.length) {
    zoneBlock = '<p class="muted-line">No vacant zones with a recorded size to compare against right now.</p>';
  } else {
    const rows = [
      ...fits.map(z => `<li class="fit-yes">
          <span>${escapeHtml(z.name)}</span>
          <span>${sqft(z.size_sqft)} sq ft</span>
          <span class="fit-note">Fits — ${sqft(z.size_sqft - est.totalSqft)} sq ft to spare</span>
        </li>`),
      ...short.map(z => `<li class="fit-no">
          <span>${escapeHtml(z.name)}</span>
          <span>${sqft(z.size_sqft)} sq ft</span>
          <span class="fit-note">${sqft(est.totalSqft - z.size_sqft)} sq ft short</span>
        </li>`),
    ].join('');

    const comboNote = combo ? `
      <p class="muted-line">No single zone is big enough, but
      ${combo.zones.map(z => escapeHtml(z.name)).join(' + ')}
      together come to ${sqft(combo.total)} sq ft, which would cover it.
      Worth checking they're next to each other.</p>` : '';

    const noneNote = !fits.length && !combo
      ? '<p class="muted-line">Nothing currently vacant is big enough, even combined.</p>' : '';

    zoneBlock = `<ul class="fit-list">${rows}</ul>${comboNote}${noneNote}`;
  }

  box.innerHTML = `
    <div class="result-headline">
      <div class="result-value">${sqft(est.totalSqft)} sq ft</div>
      <div class="result-sub">floor area to look for</div>
    </div>

    ${heightWarning}

    <div class="calc-block">
      ${working}
      <div class="calc-row"><span>Aisles &amp; access</span><span>+ ${sqft(est.aisleSqft)} sq ft <em>at ${Math.round(est.util * 100)}% usable</em></span></div>
      <div class="calc-row calc-total"><span>Total area needed</span><span>${sqft(est.totalSqft)} sq ft</span></div>
      ${heightNote}
    </div>

    ${rentBlock}

    <h4>Against your vacant zones</h4>
    ${zoneBlock}
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

function syncCalcMode() {
  const mode = calcInputs().mode;
  $('#mode-items').classList.toggle('hidden', mode !== 'items');
  $('#mode-volume').classList.toggle('hidden', mode !== 'volume');
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
  applyPreset();
  syncCalcMode();

  // Only 'input' — a 'change' listener here would re-render on blur, destroying any
  // result button mid-click before the browser can synthesise the click event.
  $('#calc-form').addEventListener('input', e => {
    if (e.target.name === 'preset') applyPreset();
    if (e.target.name === 'mode') syncCalcMode();
    if (['item_l', 'item_w', 'item_h'].includes(e.target.name)) {
      $('#calc-preset').value = 'custom';
    }
    renderCalcResults();
  });

  $('#calc-form').addEventListener('submit', e => e.preventDefault());
}

// ---- Wiring ----
document.addEventListener('DOMContentLoaded', () => {
  $all('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach(b => b.classList.remove('active'));
      $all('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#${btn.dataset.tab}`).classList.add('active');
    });
  });

  $('#lease-form').start_date.value = todayStr();
  initCalculator();
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
