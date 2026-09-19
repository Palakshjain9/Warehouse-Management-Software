const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => [...root.querySelectorAll(sel)];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBalance(balance) {
  if (balance > 0) return { text: fmtNum(balance), cls: 'balance-positive' };
  if (balance < 0) return { text: `Credit ${fmtNum(-balance)}`, cls: 'balance-credit' };
  return { text: fmtNum(balance), cls: 'balance-zero' };
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

// ---- Tabs ----
function initTabs() {
  $all('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach(b => b.classList.remove('active'));
      $all('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ---- Dashboard ----
async function loadDashboard() {
  const stats = await api('/api/dashboard');
  $('#stat-zones').textContent = stats.zoneCount;
  $('#stat-occupied').textContent = stats.occupied;
  $('#stat-vacant').textContent = stats.vacant;
  $('#stat-sqft').textContent = fmtNum(stats.totalSqft);
  $('#stat-revenue').textContent = fmtNum(stats.dailyRevenue);
  $('#stat-outstanding').textContent = fmtNum(stats.outstanding);

  const leases = await api('/api/leases');
  const active = leases.filter(l => !l.end_date);
  const tbody = $('#active-leases-table tbody');
  tbody.innerHTML = '';
  if (active.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No active leases yet.</td></tr>';
  }
  for (const l of active) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(l.zone_name)}</td>
      <td>${escapeHtml(l.vendor_name)}</td>
      <td>${fmtNum(l.daily_rate)}</td>
      <td>${l.start_date}</td>
      <td>${l.days_occupied}</td>
      <td>${fmtNum(l.accrued)}</td>
      <td>${fmtNum(l.paid)}</td>
      <td class="${fmtBalance(l.balance).cls}">${fmtBalance(l.balance).text}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ---- Zones ----
let zonesCache = [];

async function loadZones() {
  zonesCache = await api('/api/zones');
  const tbody = $('#zones-table tbody');
  tbody.innerHTML = '';
  if (zonesCache.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No zones yet. Add one above.</td></tr>';
  }
  for (const z of zonesCache) {
    const occupied = !!z.active_lease_id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(z.name)}</td>
      <td>${z.size_sqft ?? '—'}</td>
      <td>${occupied
        ? `<span class="badge occupied">Occupied — ${escapeHtml(z.vendor_name)}</span>`
        : '<span class="badge vacant">Vacant</span>'}</td>
      <td>${escapeHtml(z.notes || '')}</td>
    `;
    tbody.appendChild(tr);
  }
  populateZoneSelect();
}

function populateZoneSelect() {
  const select = $('#lease-zone-select');
  const vacant = zonesCache.filter(z => !z.active_lease_id);
  select.innerHTML = vacant.length
    ? vacant.map(z => `<option value="${z.id}">${escapeHtml(z.name)}${z.size_sqft ? ` (${z.size_sqft} sq ft)` : ''}</option>`).join('')
    : '<option value="">No vacant zones</option>';
}

// ---- Vendors ----
let vendorsCache = [];

async function loadVendors() {
  vendorsCache = await api('/api/vendors');
  const tbody = $('#vendors-table tbody');
  tbody.innerHTML = '';
  if (vendorsCache.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No vendors yet. Add one above.</td></tr>';
  }
  for (const v of vendorsCache) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(v.name)}</td>
      <td>${escapeHtml(v.contact || '')}</td>
      <td>${escapeHtml(v.notes || '')}</td>
    `;
    tbody.appendChild(tr);
  }
  populateVendorSelect();
}

function populateVendorSelect() {
  const select = $('#lease-vendor-select');
  select.innerHTML = vendorsCache.length
    ? vendorsCache.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')
    : '<option value="">No vendors yet</option>';
}

// ---- Leases ----
async function loadLeases() {
  const leases = await api('/api/leases');
  const tbody = $('#leases-table tbody');
  tbody.innerHTML = '';
  if (leases.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No leases yet.</td></tr>';
  }
  for (const l of leases) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(l.zone_name)}</td>
      <td>${escapeHtml(l.vendor_name)}</td>
      <td>${fmtNum(l.daily_rate)}</td>
      <td>${l.start_date}</td>
      <td>${l.end_date || '—'}</td>
      <td>${l.days_occupied}</td>
      <td>${fmtNum(l.accrued)}</td>
      <td>${fmtNum(l.paid)}</td>
      <td class="${fmtBalance(l.balance).cls}">${fmtBalance(l.balance).text}</td>
      <td class="row-actions">
        <button data-action="pay" data-id="${l.id}">Record payment</button>
        ${l.end_date ? '' : `<button data-action="end" data-id="${l.id}">End lease</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// ---- Payment modal ----
function openPaymentModal(leaseId) {
  const form = $('#payment-form');
  form.reset();
  form.lease_id.value = leaseId;
  form.paid_date.value = todayStr();
  $('#payment-error').textContent = '';
  $('#modal-backdrop').classList.remove('hidden');
}

function closePaymentModal() {
  $('#modal-backdrop').classList.add('hidden');
}

// ---- Shared ----
async function refreshAll() {
  await Promise.all([loadDashboard(), loadZones(), loadVendors(), loadLeases()]);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ---- Wiring ----
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  $('#lease-form').start_date.value = todayStr();

  $('#zone-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    $('#zone-error').textContent = '';
    try {
      await api('/api/zones', { method: 'POST', body: JSON.stringify(formToObject(form)) });
      form.reset();
      await refreshAll();
    } catch (err) {
      $('#zone-error').textContent = err.message;
    }
  });

  $('#vendor-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    $('#vendor-error').textContent = '';
    try {
      await api('/api/vendors', { method: 'POST', body: JSON.stringify(formToObject(form)) });
      form.reset();
      await refreshAll();
    } catch (err) {
      $('#vendor-error').textContent = err.message;
    }
  });

  $('#lease-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    $('#lease-error').textContent = '';
    try {
      await api('/api/leases', { method: 'POST', body: JSON.stringify(formToObject(form)) });
      form.reset();
      form.start_date.value = todayStr();
      await refreshAll();
    } catch (err) {
      $('#lease-error').textContent = err.message;
    }
  });

  $('#leases-table').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'pay') {
      openPaymentModal(id);
    } else if (btn.dataset.action === 'end') {
      if (confirm('End this lease as of today?')) {
        api(`/api/leases/${id}/end`, { method: 'POST', body: JSON.stringify({}) })
          .then(refreshAll)
          .catch(err => alert(err.message));
      }
    }
  });

  $('#payment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const data = formToObject(form);
    $('#payment-error').textContent = '';
    try {
      await api(`/api/leases/${data.lease_id}/payments`, { method: 'POST', body: JSON.stringify(data) });
      closePaymentModal();
      await refreshAll();
    } catch (err) {
      $('#payment-error').textContent = err.message;
    }
  });

  $('#modal-cancel').addEventListener('click', closePaymentModal);

  refreshAll();
});
