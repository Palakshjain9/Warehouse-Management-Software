const CURRENCY = '₹';
const LOCALE = 'en-IN';

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = { spaces: [], bookings: [] };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function money(n) {
  return CURRENCY + Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: 0 });
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
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
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
}

// ---- Dashboard ----
async function loadDashboard() {
  const stats = await api('/api/dashboard');
  $('#stat-spaces').textContent = stats.spaceCount;
  $('#stat-booked').textContent = stats.bookedToday;
  $('#stat-available').textContent = stats.availableToday;
  $('#stat-sqft').textContent = Number(stats.totalSqft || 0).toLocaleString(LOCALE);
  $('#stat-revenue').textContent = money(stats.confirmedRevenue);
  $('#stat-upcoming').textContent = stats.upcoming;

  const isEmpty = stats.spaceCount === 0;
  $('#empty-state').classList.toggle('hidden', !isEmpty);
  $('#dashboard-content').classList.toggle('hidden', isEmpty);

  const today = todayStr();
  const running = state.bookings.filter(
    b => b.status === 'confirmed' && b.start_date <= today && b.end_date >= today
  );

  const tbody = $('#today-table tbody');
  tbody.innerHTML = running.length
    ? running.map(b => `<tr>
        <td data-label="Space">${escapeHtml(b.space_name)}</td>
        <td data-label="Customer">${escapeHtml(b.customer_name || '—')}</td>
        <td data-label="Dates">${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}</td>
        <td data-label="Days">${b.days}</td>
        <td data-label="Amount">${money(b.amount)}</td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="5">Nothing booked for today.</td></tr>';
}

// ---- Spaces ----
async function loadSpaces() {
  state.spaces = await api('/api/spaces');
  const tbody = $('#spaces-table tbody');

  tbody.innerHTML = state.spaces.length
    ? state.spaces.map(s => `<tr>
        <td data-label="Name">
          ${escapeHtml(s.name)}
          ${s.notes ? `<div class="cell-note">${escapeHtml(s.notes)}</div>` : ''}
        </td>
        <td data-label="Dimensions">${s.length_ft ? `${s.length_ft} × ${s.width_ft} × ${s.height_ft} ft` : '—'}</td>
        <td data-label="Floor">${s.size_sqft == null ? '—' : `${Number(s.size_sqft).toLocaleString(LOCALE)} sq ft`}</td>
        <td data-label="Volume">${s.volume_cuft ? `${Math.round(s.volume_cuft).toLocaleString(LOCALE)} cu ft` : '—'}</td>
        <td data-label="Walls">${escapeHtml(wallInfo(s.wall_support).short)}</td>
        <td data-label="Price/day">${s.price_per_day ? money(s.price_per_day) : '—'}</td>
        <td data-label="Today">${s.booked_today
          ? '<span class="badge occupied">Booked</span>'
          : '<span class="badge vacant">Available</span>'}</td>
        <td data-label="" class="row-actions">
          <button data-action="space-edit" data-id="${s.id}">Edit</button>
          <button data-action="space-delete" data-id="${s.id}" class="danger-text">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="8">No spaces yet. Add one above.</td></tr>';
}

// ---- Bookings ----
const STATUS_BADGE = {
  confirmed: 'vacant',
  held: 'held',
  expired: 'muted',
  cancelled: 'muted',
};

async function loadBookings() {
  state.bookings = await api('/api/bookings');
  const tbody = $('#bookings-table tbody');

  tbody.innerHTML = state.bookings.length
    ? state.bookings.map(b => `<tr class="${b.status === 'confirmed' ? '' : 'row-ended'}">
        <td data-label="Space">${escapeHtml(b.space_name)}</td>
        <td data-label="Customer">
          ${escapeHtml(b.customer_name || '—')}
          ${b.contact ? `<div class="cell-note">${escapeHtml(b.contact)}</div>` : ''}
        </td>
        <td data-label="Dates">${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}</td>
        <td data-label="Days">${b.days}</td>
        <td data-label="Storing">${b.quantity
          ? `${Number(b.quantity).toLocaleString(LOCALE)} × ${escapeHtml(b.item_label || 'items')}`
          : '—'}
          ${b.fit_warning ? `<div class="cell-note warn-note">${escapeHtml(b.fit_warning)}</div>` : ''}
        </td>
        <td data-label="Amount">${b.amount ? money(b.amount) : '—'}</td>
        <td data-label="Status">
          <span class="badge ${STATUS_BADGE[b.status] || 'muted'}">${escapeHtml(b.status)}</span>
          ${b.status === 'held' ? `<div class="cell-note">${b.seconds_remaining}s left</div>` : ''}
        </td>
        <td data-label="" class="row-actions">
          ${b.status === 'confirmed' ? `<button data-action="booking-cancel" data-id="${b.id}">Cancel</button>` : ''}
          <button data-action="booking-delete" data-id="${b.id}" class="danger-text">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="8">No bookings yet.</td></tr>';
}

function openSpaceEdit(id) {
  const s = state.spaces.find(x => x.id === Number(id));
  if (!s) return;
  showModal('Edit space', `
    <form id="edit-form" data-id="${s.id}">
      <label>Name<input type="text" name="name" value="${escapeHtml(s.name)}" required></label>
      <label>Length (ft)<input type="number" name="length_ft" min="0" step="any" value="${s.length_ft ?? ''}" required></label>
      <label>Width (ft)<input type="number" name="width_ft" min="0" step="any" value="${s.width_ft ?? ''}" required></label>
      <label>Height (ft)<input type="number" name="height_ft" min="0" step="any" value="${s.height_ft ?? ''}" required></label>
      <label>Price per day<input type="number" name="price_per_day" min="0" step="any" value="${s.price_per_day ?? ''}"></label>
      <label>Wall support<select name="wall_support">${WALL_OPTIONS
        .map(w => `<option value="${w.value}"${Number(s.wall_support) === w.value ? ' selected' : ''}>${escapeHtml(w.label)}</option>`)
        .join('')}</select></label>
      <label>Notes<input type="text" name="notes" value="${escapeHtml(s.notes || '')}"></label>
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
  await Promise.all([loadSpaces(), loadBookings()]);
  await loadDashboard();
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

const actions = {
  async seed() {
    if (!confirm('Replace everything currently in the app with the sample area?')) return;
    await api('/api/demo/seed', { method: 'POST' });
    await loadPlanImage();
    await refreshAll();
    toast('Sample data loaded');
  },

  async reset() {
    if (!confirm('Delete all spaces and bookings? This cannot be undone.')) return;
    await api('/api/demo/reset', { method: 'POST' });
    closeModal();
    await loadPlanImage();
    await refreshAll();
    toast('All data cleared');
  },

  'space-edit': id => openSpaceEdit(id),
  'modal-cancel': () => closeModal(),

  async 'space-delete'(id) {
    const s = state.spaces.find(x => x.id === Number(id));
    if (!confirm(`Delete space "${s?.name ?? id}"?`)) return;
    await api(`/api/spaces/${id}`, { method: 'DELETE' });
    await refreshAll();
    toast('Space deleted');
  },

  async 'booking-cancel'(id) {
    if (!confirm('Cancel this booking and free the space up?')) return;
    await api(`/api/bookings/${id}/cancel`, { method: 'POST' });
    await refreshAll();
    toast('Booking cancelled');
  },

  async 'booking-delete'(id) {
    if (!confirm('Delete this booking from the record?')) return;
    await api(`/api/bookings/${id}`, { method: 'DELETE' });
    await refreshAll();
    toast('Booking deleted');
  },

  'map-start'(id) {
    mappingSpaceId = Number(id);
    selectedHotspotId = null;
    renderPlan();
  },

  'map-cancel'() {
    mappingSpaceId = null;
    renderPlan();
  },

  async 'map-clear'(id) {
    await api(`/api/spaces/${id}/hotspot`, { method: 'PATCH', body: JSON.stringify({ hot_x: null }) });
    if (selectedHotspotId === Number(id)) selectedHotspotId = null;
    await refreshAll();
    toast('Area cleared');
  },

  async 'plan-remove-image'() {
    if (!confirm('Remove the drawing? Every marked area is cleared with it.')) return;
    await api('/api/plan/image', { method: 'DELETE' });
    mappingSpaceId = null;
    selectedHotspotId = null;
    await loadPlanImage();
    await refreshAll();
    toast('Drawing removed');
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
  if (e.target.id !== 'edit-form') return;
  e.preventDefault();
  const form = e.target;
  const ok = await submitForm(form, $('#edit-error'), () =>
    api(`/api/spaces/${form.dataset.id}`, { method: 'PATCH', body: JSON.stringify(formToObject(form)) }));
  if (ok) {
    closeModal();
    await refreshAll();
    toast('Saved');
  }
});

// ---- The add-a-space form ----
// Wall factors and the capacity maths live in fit.js, shared with /book.

function initSpaceForm() {
  $('#space-wall-select').innerHTML = WALL_OPTIONS
    .map(w => `<option value="${w.value}">${escapeHtml(w.label)}</option>`).join('');
}

// ---- Plan drawing and hotspot mapping ----
// The drawing is the owner's own layout image. Hotspots are rectangles drawn over it,
// stored as fractions of the image so they hold up at any display size.

let planImage = null;
let mappingSpaceId = null;
let hotspotDraw = null;
let selectedHotspotId = null;

async function loadPlanImage() {
  planImage = (await api('/api/plan/image')).data_url || null;
  renderPlan();
}

function hotspotOf(s) {
  return s.hot_w != null && s.hot_h != null
    ? { x: Number(s.hot_x), y: Number(s.hot_y), w: Number(s.hot_w), h: Number(s.hot_h) }
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

  const boxes = state.spaces.filter(hotspotOf).map(s => {
    const h = hotspotOf(s);
    const classes = ['hot-box', s.booked_today ? 'is-taken' : 'is-free'];
    if (mappingSpaceId === s.id) classes.push('mapping-target');
    if (selectedHotspotId === s.id) classes.push('selected');
    return `<div class="${classes.join(' ')}" data-hot-id="${s.id}"
        style="left:${h.x * 100}%;top:${h.y * 100}%;width:${h.w * 100}%;height:${h.h * 100}%">
        <span>${escapeHtml(s.name)}</span>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div id="plan-frame" class="${mappingSpaceId ? 'drawing' : ''}">
      <img id="plan-img" src="${planImage}" alt="Basement layout">
      ${boxes}
      <div id="draw-box" class="hidden"></div>
    </div>`;

  $('#plan-tools').innerHTML = `
    <div class="plan-legend">
      <span><i class="swatch is-free"></i> Available today</span>
      <span><i class="swatch is-taken"></i> Booked today</span>
    </div>
    <div class="plan-tools-buttons">
      <label class="file-button">Replace drawing<input type="file" id="plan-file" accept="image/png,image/jpeg,image/webp" hidden></label>
      <button data-action="plan-remove-image" class="danger-text">Remove drawing</button>
    </div>`;

  renderPlanList();
}

function renderPlanList() {
  const list = $('#plan-list');
  if (!planImage) { list.innerHTML = ''; return; }

  const rows = state.spaces.map(s => {
    const mapped = !!hotspotOf(s);
    return `<li class="${mapped ? 'mapped' : 'unmapped'}">
      <span class="fit-name">${escapeHtml(s.name)}</span>
      <span class="muted-inline">${s.size_sqft ? `${Number(s.size_sqft).toLocaleString(LOCALE)} sq ft` : ''}
        ${s.height_ft ? `· ${s.height_ft} ft high` : ''}</span>
      <span class="map-actions">
        ${mappingSpaceId === s.id
          ? `<em>Drag a box on the drawing…</em> <button data-action="map-cancel">Cancel</button>`
          : `<button data-action="map-start" data-id="${s.id}">${mapped ? 'Redraw area' : 'Mark area'}</button>`}
        ${mapped ? `<button data-action="map-clear" data-id="${s.id}" class="danger-text">Clear</button>` : ''}
      </span>
    </li>`;
  }).join('');

  const unmapped = state.spaces.filter(s => !hotspotOf(s)).length;
  list.innerHTML = `
    <h4>Spaces on the drawing</h4>
    ${unmapped ? `<p class="muted-line">${unmapped} space${unmapped === 1 ? '' : 's'}
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
  const r = $('#plan-frame').getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (evt.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (evt.clientY - r.top) / r.height)),
  };
}

function onPlanStagePointerDown(e) {
  if (!planImage) return;

  if (!mappingSpaceId) {
    const box = e.target.closest('.hot-box');
    selectedHotspotId = box ? Number(box.dataset.hotId) : null;
    renderPlan();
    return;
  }

  const start = frameFraction(e);
  hotspotDraw = { ...start, x2: start.x, y2: start.y };
  $('#draw-box').classList.remove('hidden');
  $('#plan-frame').setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPlanStagePointerMove(e) {
  if (!hotspotDraw) return;
  const p = frameFraction(e);
  hotspotDraw.x2 = p.x;
  hotspotDraw.y2 = p.y;

  const draw = $('#draw-box');
  draw.style.left = `${Math.min(hotspotDraw.x, hotspotDraw.x2) * 100}%`;
  draw.style.top = `${Math.min(hotspotDraw.y, hotspotDraw.y2) * 100}%`;
  draw.style.width = `${Math.abs(hotspotDraw.x2 - hotspotDraw.x) * 100}%`;
  draw.style.height = `${Math.abs(hotspotDraw.y2 - hotspotDraw.y) * 100}%`;
}

async function onPlanStagePointerUp() {
  if (!hotspotDraw) return;
  const drawn = hotspotDraw;
  hotspotDraw = null;
  $('#draw-box').classList.add('hidden');

  const spaceId = mappingSpaceId;
  try {
    await api(`/api/spaces/${spaceId}/hotspot`, {
      method: 'PATCH',
      body: JSON.stringify({
        hot_x: Math.min(drawn.x, drawn.x2),
        hot_y: Math.min(drawn.y, drawn.y2),
        hot_w: Math.abs(drawn.x2 - drawn.x),
        hot_h: Math.abs(drawn.y2 - drawn.y),
      }),
    });
    mappingSpaceId = null;
    selectedHotspotId = spaceId;
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

  initSpaceForm();
  initPlan();
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  $('#space-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const ok = await submitForm(form, $('#space-error'), () =>
      api('/api/spaces', { method: 'POST', body: JSON.stringify(formToObject(form)) }));
    if (ok) { form.reset(); await refreshAll(); toast('Space added'); }
  });

  loadPlanImage();
  refreshAll();
});
