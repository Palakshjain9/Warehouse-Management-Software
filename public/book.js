const CURRENCY = '₹';
const LOCALE = 'en-IN';
const LONG_PRESS_MS = 450;

const $ = (sel, root = document) => root.querySelector(sel);

const state = { spaces: [], planImage: null, chosen: null, fit: null };

function money(n) {
  return CURRENCY + Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

function whole(n) {
  return Math.round(Number(n)).toLocaleString(LOCALE);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function goToStep(step) {
  document.querySelectorAll('.book-step').forEach(s => s.classList.remove('active'));
  $(`#${step}`).classList.add('active');
  document.querySelectorAll('.steps li').forEach(li => {
    const n = Number(li.dataset.step);
    const current = Number(String(step).replace('step-', '')) || 4;
    li.classList.toggle('current', n === current);
    li.classList.toggle('done', n < current);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Step 1: pick a space on the drawing ----
function renderStage() {
  const stage = $('#book-stage');

  if (!state.planImage) {
    stage.innerHTML = `<div class="empty-state">
      <h2>The plan isn't up yet</h2>
      <p>The layout drawing hasn't been uploaded. Please check back shortly.</p>
    </div>`;
    return;
  }

  const boxes = state.spaces.map(s => {
    const classes = ['hot-box', 'pickable', s.taken ? 'is-taken' : 'is-free'];
    if (state.chosen?.id === s.id) classes.push('chosen');
    // No name label — the owner's drawing already carries the names, and an overlay
    // label would sit on top of them.
    return `<div class="${classes.join(' ')}" data-space-id="${s.id}"
        style="left:${s.hot_x * 100}%;top:${s.hot_y * 100}%;width:${s.hot_w * 100}%;height:${s.hot_h * 100}%">
        ${state.chosen?.id === s.id ? `<span>${escapeHtml(s.name)}</span>` : ''}
      </div>`;
  }).join('');

  stage.innerHTML = `<div id="book-frame">
      <img src="${state.planImage}" alt="Basement layout">
      ${boxes}
    </div>`;
}

function renderDetail(space, { chosen = false } = {}) {
  const box = $('#book-detail');
  if (!space) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `
    <div class="space-card">
      <div class="space-card-head">
        <strong>${escapeHtml(space.name)}</strong>
        <span class="badge ${space.taken ? 'occupied' : 'vacant'}">${space.taken ? 'Already taken' : 'Available'}</span>
      </div>
      <div class="space-facts">
        <div><span>Floor space</span><strong>${whole(space.size_sqft)} sq ft</strong></div>
        <div><span>Height</span><strong>${space.height_ft} ft</strong></div>
        <div><span>Footprint</span><strong>${space.length_ft} × ${space.width_ft} ft</strong></div>
        ${space.list_rate_per_day ? `<div><span>Rate</span><strong>${money(space.list_rate_per_day)} / day</strong></div>` : ''}
      </div>
      ${space.taken
        ? '<p class="muted-line">Someone is in this one at the moment. Pick another area.</p>'
        : chosen
          ? `<button class="primary" data-action="choose" data-id="${space.id}">Continue with ${escapeHtml(space.name)}</button>`
          : `<button class="primary" data-action="choose" data-id="${space.id}">Pick this space</button>`}
    </div>`;
}

// A long press shows the facts; a short tap picks the space.
let pressTimer = null;
let pressHandled = false;

function initStage() {
  const stage = $('#book-stage');

  stage.addEventListener('pointerdown', e => {
    const box = e.target.closest('.hot-box');
    if (!box) return;
    pressHandled = false;
    const space = state.spaces.find(s => s.id === Number(box.dataset.spaceId));
    pressTimer = setTimeout(() => {
      pressHandled = true;
      renderDetail(space);
      $('#book-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, LONG_PRESS_MS);
  });

  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  stage.addEventListener('pointermove', cancelPress);
  stage.addEventListener('pointercancel', cancelPress);
  stage.addEventListener('pointerleave', cancelPress);

  stage.addEventListener('pointerup', e => {
    clearTimeout(pressTimer);
    const box = e.target.closest('.hot-box');
    if (!box || pressHandled) return;

    const space = state.spaces.find(s => s.id === Number(box.dataset.spaceId));
    if (!space) return;
    state.chosen = space.taken ? null : space;
    renderStage();
    renderDetail(space, { chosen: true });
  });
}

// ---- Step 2: what they're storing ----
function goodsInputs() {
  return Object.fromEntries(new FormData($('#goods-form')).entries());
}

function currentItem() {
  const d = goodsInputs();
  const preset = presetById(d.preset);
  const exact = $('#exact-toggle').checked;

  if (exact) {
    return {
      item: makeItem({ l: d.item_l, w: d.item_w, h: d.item_h, unit: d.dim_unit, quantity: d.quantity }),
      label: preset && preset.id !== 'custom' ? preset.label.split(' (')[0] : 'items',
      exact: true,
    };
  }

  if (!preset || preset.id === 'custom') return { item: null, label: 'items', exact: false };
  return {
    item: makeItem({ l: preset.l, w: preset.w, h: preset.h, unit: 'm', quantity: d.quantity }),
    label: preset.label.split(' (')[0],
    exact: false,
  };
}

function renderFit() {
  const box = $('#fit-verdict');
  const { item, exact } = currentItem();
  state.fit = null;

  if (!state.chosen) { box.innerHTML = ''; return; }
  if (!item) {
    box.innerHTML = `<div class="notice info-notice">
      Tell us roughly how big one item is and we'll check it against ${escapeHtml(state.chosen.name)}.
    </div>`;
    return;
  }

  const cap = spaceCapacity(state.chosen, item);
  state.fit = { capacity: cap.capacity, qty: item.qty, exact };

  const basis = exact
    ? 'based on the size you gave us'
    : 'based on a typical size for that kind of item';

  if (cap.capacity >= item.qty) {
    box.innerHTML = `<div class="notice ok-notice">
        <strong>That should fit.</strong>
        ${escapeHtml(state.chosen.name)} holds roughly ${whole(cap.capacity)}
        of these, and you have ${whole(item.qty)} — ${basis}.
      </div>`;
    return;
  }

  state.fit.warning = `Might not fit: holds about ${whole(cap.capacity)}, needs ${whole(item.qty)}`;
  box.innerHTML = `<div class="notice warn-notice">
      <strong>This might be tight.</strong>
      ${escapeHtml(state.chosen.name)} looks like it holds roughly ${whole(cap.capacity)}
      of these, and you're planning on ${whole(item.qty)} — ${basis}.
      ${exact
        ? 'You can still go ahead, but you may need a second space.'
        : 'If you know the exact size of one item, tick the box above and we can be more precise.'}
    </div>`;
}

function renderChosenBars() {
  const s = state.chosen;
  const html = s
    ? `<strong>${escapeHtml(s.name)}</strong>
       <span class="muted-inline">${whole(s.size_sqft)} sq ft · ${s.height_ft} ft high
       ${s.list_rate_per_day ? `· ${money(s.list_rate_per_day)} / day` : ''}</span>`
    : '';
  $('#chosen-bar').innerHTML = html;
  $('#chosen-bar-3').innerHTML = html;
}

// ---- Step 3: confirm ----
function confirmInputs() {
  return Object.fromEntries(new FormData($('#confirm-form')).entries());
}

function renderSummary() {
  const s = state.chosen;
  const { item, label } = currentItem();
  const d = confirmInputs();
  const days = Math.max(1, Math.floor(Number(d.days) || 0));

  $('#summary').innerHTML = `
    <div class="calc-block">
      <div class="calc-row"><span>Space</span><span>${escapeHtml(s.name)}</span></div>
      <div class="calc-row"><span>Floor space</span><span>${whole(s.size_sqft)} sq ft · ${s.height_ft} ft high</span></div>
      <div class="calc-row"><span>Storing</span><span>${item ? `${whole(item.qty)} × ${escapeHtml(label)}` : '—'}</span></div>
      ${state.fit?.warning ? `<div class="calc-row"><span>Note</span><span class="balance-positive">${escapeHtml(state.fit.warning)}</span></div>` : ''}
    </div>`;

  const rate = Number(s.list_rate_per_day) || 0;
  $('#cost-block').innerHTML = rate > 0
    ? `<div class="calc-block">
        <div class="calc-row"><span>${money(rate)} per day</span><span>× ${days} days</span></div>
        <div class="calc-row calc-total"><span>Total</span><span>${money(rate * days)}</span></div>
      </div>`
    : `<p class="muted-line">No rate is listed for this space yet — we'll confirm the price with you.</p>`;
}

async function submitBooking() {
  const s = state.chosen;
  const d = confirmInputs();
  const { item, label } = currentItem();
  $('#confirm-error').textContent = '';

  if (!d.customer_name || !d.customer_name.trim()) {
    $('#confirm-error').textContent = 'Please tell us your name.';
    return;
  }

  try {
    const result = await api('/api/public/bookings', {
      method: 'POST',
      body: JSON.stringify({
        zone_id: s.id,
        customer_name: d.customer_name,
        contact: d.contact,
        quantity: item?.qty ?? null,
        item_label: label,
        item_l_ft: item?.l ?? null,
        item_w_ft: item?.w ?? null,
        item_h_ft: item?.h ?? null,
        start_date: d.start_date,
        estimated_capacity: state.fit?.capacity ?? null,
        fit_warning: state.fit?.warning ?? null,
      }),
    });

    const rate = Number(s.list_rate_per_day) || 0;
    const days = Math.max(1, Math.floor(Number(d.days) || 0));
    $('#done-text').innerHTML = `Thanks ${escapeHtml(d.customer_name)} — we've put
      <strong>${escapeHtml(result.space)}</strong> aside and someone will be in touch to confirm.`;
    $('#payment-stub').innerHTML = `
      <div class="notice info-notice payment-stub">
        <strong>Payment isn't connected yet.</strong>
        This is where the card or UPI step will go${rate > 0 ? `, for ${money(rate * days)}` : ''}.
        Your booking is saved either way.
      </div>`;
    goToStep('step-done');
  } catch (err) {
    $('#confirm-error').textContent = err.message;
  }
}

// ---- Actions ----
const actions = {
  choose(id) {
    const space = state.spaces.find(s => s.id === Number(id));
    if (!space || space.taken) return;
    state.chosen = space;
    renderChosenBars();
    renderFit();
    goToStep('step-2');
  },
  'back-to-1': () => goToStep('step-1'),
  'back-to-2': () => goToStep('step-2'),
  'to-step-3'() {
    if (!state.chosen) { toast('Pick a space first', 'err'); return; }
    const { item } = currentItem();
    if (!item) { toast('Tell us how many items and roughly what size', 'err'); return; }
    renderSummary();
    goToStep('step-3');
  },
  'submit-booking': () => submitBooking(),
};

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const handler = actions[btn.dataset.action];
  if (!handler) return;
  e.preventDefault();
  handler(btn.dataset.id);
});

// ---- Start ----
document.addEventListener('DOMContentLoaded', async () => {
  $('#goods-preset').innerHTML = ITEM_PRESETS
    .map(p => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  $('#confirm-form').start_date.value = todayStr();

  initStage();

  $('#goods-form').addEventListener('input', e => {
    if (e.target.id === 'exact-toggle') {
      $('#exact-fields').classList.toggle('hidden', !e.target.checked);
      const preset = presetById(goodsInputs().preset);
      const form = $('#goods-form');
      if (e.target.checked && preset && preset.id !== 'custom' && !form.item_l.value) {
        form.dim_unit.value = 'm';
        form.item_l.value = preset.l;
        form.item_w.value = preset.w;
        form.item_h.value = preset.h;
      }
    }
    renderFit();
  });

  $('#goods-form').addEventListener('submit', e => e.preventDefault());
  $('#confirm-form').addEventListener('input', renderSummary);
  $('#confirm-form').addEventListener('submit', e => e.preventDefault());

  try {
    const [spaces, image] = await Promise.all([
      api('/api/public/spaces'),
      api('/api/public/plan-image'),
    ]);
    state.spaces = spaces;
    state.planImage = image.data_url;
    renderStage();
  } catch (err) {
    toast(err.message, 'err');
  }
});
