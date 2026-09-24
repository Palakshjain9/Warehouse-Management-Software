const CURRENCY = '₹';
const LOCALE = 'en-IN';
const LONG_PRESS_MS = 450;

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  spaces: [],
  planImage: null,
  range: null,
  chosen: null,
  fit: null,
  hold: null,
};

let countdownTimer = null;

function money(n) {
  return CURRENCY + Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

function whole(n) {
  return Math.round(Number(n)).toLocaleString(LOCALE);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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

async function api(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Something went wrong');
    err.expired = !!body.expired;
    throw err;
  }
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

const STEP_NUMBER = { 'step-1': 1, 'step-2': 2, 'step-3': 3, 'step-4': 4 };

function goToStep(step) {
  document.querySelectorAll('.book-step').forEach(s => s.classList.remove('active'));
  $(`#${step}`).classList.add('active');
  const current = STEP_NUMBER[step] ?? 5;
  document.querySelectorAll('.steps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('current', n === current);
    li.classList.toggle('done', n < current);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Step 1: dates ----
function dateInputs() {
  return Object.fromEntries(new FormData($('#dates-form')).entries());
}

function renderDatesSummary() {
  const { start_date, days } = dateInputs();
  const n = Math.max(1, Math.floor(Number(days) || 1));
  if (!start_date) { $('#dates-summary').textContent = ''; return; }
  const [y, m, d] = start_date.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCDate(end.getUTCDate() + n - 1);
  $('#dates-summary').textContent =
    `${fmtDate(start_date)} to ${fmtDate(end.toISOString().slice(0, 10))} · ${n} day${n === 1 ? '' : 's'}`;
}

async function loadSpacesForDates() {
  const { start_date, days } = dateInputs();
  const data = await api(`/api/public/spaces?start=${start_date}&days=${days}`);
  state.spaces = data.spaces;
  state.range = { start: data.start, days: data.days, end: data.end };

  if (state.chosen) {
    const still = state.spaces.find(s => s.id === state.chosen.id);
    state.chosen = still && still.available ? still : null;
  }

  $('#dates-bar').innerHTML = `
    <strong>${fmtDate(data.start)} to ${fmtDate(data.end)}</strong>
    <span class="muted-inline">${data.days} day${data.days === 1 ? '' : 's'} ·
      ${data.spaces.filter(s => s.available).length} of ${data.spaces.length} free</span>`;
  renderStage();
  renderDetail(null);
}

// ---- Step 2: pick a space ----
function renderStage() {
  const stage = $('#book-stage');

  if (!state.planImage) {
    stage.innerHTML = `<div class="empty-state">
      <h2>The plan isn't up yet</h2>
      <p>The layout drawing hasn't been uploaded. Please check back shortly.</p>
    </div>`;
    return;
  }

  // No name label — the owner's drawing already carries the names, and an overlay
  // label would sit on top of them.
  const boxes = state.spaces.map(s => {
    const cls = state.chosen?.id === s.id ? 'is-chosen' : s.available ? 'is-free' : 'is-taken';
    return `<div class="hot-box pickable ${cls}" data-space-id="${s.id}"
        style="left:${s.hot_x * 100}%;top:${s.hot_y * 100}%;width:${s.hot_w * 100}%;height:${s.hot_h * 100}%">
        ${state.chosen?.id === s.id ? `<span>${escapeHtml(s.name)}</span>` : ''}
      </div>`;
  }).join('');

  stage.innerHTML = `<div id="book-frame">
      <img src="${state.planImage}" alt="Basement layout">
      ${boxes}
    </div>`;
}

function renderDetail(space) {
  const box = $('#book-detail');
  if (!space) { box.innerHTML = ''; return; }

  const nights = state.range?.days ?? 1;
  box.innerHTML = `
    <div class="space-card">
      <div class="space-card-head">
        <strong>${escapeHtml(space.name)}</strong>
        <span class="badge ${space.available ? 'vacant' : 'occupied'}">${space.available ? 'Available' : 'Booked for these dates'}</span>
      </div>
      <div class="space-facts">
        <div><span>Floor area</span><strong>${whole(space.size_sqft)} sq ft</strong></div>
        <div><span>Height</span><strong>${space.height_ft} ft</strong></div>
        <div><span>Footprint</span><strong>${space.length_ft} × ${space.width_ft} ft</strong></div>
        ${space.price_per_day ? `<div><span>Price</span><strong>${money(space.price_per_day)} / day</strong></div>` : ''}
      </div>
      ${space.available
        ? `<button class="primary" data-action="choose" data-id="${space.id}">
             Pick ${escapeHtml(space.name)}${space.price_per_day ? ` — ${money(space.price_per_day * nights)} for ${nights} day${nights === 1 ? '' : 's'}` : ''}
           </button>`
        : '<p class="muted-line">Someone has this one for the dates you picked. Try another space, or change your dates.</p>'}
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
    if (space.available) state.chosen = space;
    renderStage();
    renderDetail(space);
  });
}

// ---- Step 3: goods ----
function goodsInputs() {
  return Object.fromEntries(new FormData($('#goods-form')).entries());
}

function currentItem() {
  const d = goodsInputs();
  const preset = presetById(d.preset);

  if ($('#exact-toggle').checked) {
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
  const basis = exact ? 'based on the size you gave us' : 'based on a typical size for that kind of item';

  if (cap.capacity >= item.qty) {
    box.innerHTML = `<div class="notice ok-notice">
        <strong>That should fit.</strong>
        ${escapeHtml(state.chosen.name)} holds roughly ${whole(cap.capacity)} of these,
        and you have ${whole(item.qty)} — ${basis}.
      </div>`;
    return;
  }

  state.fit.warning = `Might not fit: holds about ${whole(cap.capacity)}, needs ${whole(item.qty)}`;
  box.innerHTML = `<div class="notice warn-notice">
      <strong>This might be tight.</strong>
      ${escapeHtml(state.chosen.name)} looks like it holds roughly ${whole(cap.capacity)} of these,
      and you're planning on ${whole(item.qty)} — ${basis}.
      ${exact
        ? 'You can still go ahead, but you may need a second space.'
        : 'If you know the exact size of one item, tick the box above and we can be more precise.'}
    </div>`;
}

function renderChosenBar() {
  const s = state.chosen;
  $('#chosen-bar').innerHTML = s
    ? `<strong>${escapeHtml(s.name)}</strong>
       <span class="muted-inline">${whole(s.size_sqft)} sq ft · ${s.height_ft} ft high ·
       ${fmtDate(state.range.start)} to ${fmtDate(state.range.end)}</span>`
    : '';
}

// ---- Step 4: checkout, against the clock ----
function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function renderCountdown(secondsLeft) {
  const el = $('#hold-timer');
  if (secondsLeft <= 0) {
    el.innerHTML = '';
    return;
  }
  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, '0');
  el.className = `hold-timer${secondsLeft <= 30 ? ' urgent' : ''}`;
  el.innerHTML = `We're holding ${escapeHtml(state.hold.space)} for you —
    <strong>${mins}:${secs}</strong> left to finish`;
}

function startCountdown(seconds) {
  stopCountdown();
  let left = seconds;
  renderCountdown(left);
  countdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      stopCountdown();
      expireHold();
      return;
    }
    renderCountdown(left);
  }, 1000);
}

function expireHold() {
  stopCountdown();
  state.hold = null;
  goToStep('step-expired');
}

async function beginCheckout() {
  const { item, label } = currentItem();
  const body = {
    space_id: state.chosen.id,
    start_date: state.range.start,
    days: state.range.days,
    quantity: item?.qty ?? null,
    item_label: label,
    item_l_ft: item?.l ?? null,
    item_w_ft: item?.w ?? null,
    item_h_ft: item?.h ?? null,
    estimated_capacity: state.fit?.capacity ?? null,
    fit_warning: state.fit?.warning ?? null,
  };

  const hold = await api('/api/public/holds', { method: 'POST', body: JSON.stringify(body) });
  state.hold = hold;

  $('#confirm-error').textContent = '';
  $('#summary').innerHTML = `
    <div class="calc-block">
      <div class="calc-row"><span>Space</span><span>${escapeHtml(hold.space)}</span></div>
      <div class="calc-row"><span>Dates</span><span>${fmtDate(hold.start_date)} to ${fmtDate(hold.end_date)}</span></div>
      <div class="calc-row"><span>Storing</span><span>${item ? `${whole(item.qty)} × ${escapeHtml(label)}` : '—'}</span></div>
      ${state.fit?.warning ? `<div class="calc-row"><span>Note</span><span class="balance-positive">${escapeHtml(state.fit.warning)}</span></div>` : ''}
      ${hold.amount
        ? `<div class="calc-row"><span>${money(hold.amount / hold.days)} per day × ${hold.days}</span><span></span></div>
           <div class="calc-row calc-total"><span>To pay</span><span>${money(hold.amount)}</span></div>`
        : '<div class="calc-row"><span>Price</span><span>We’ll confirm it with you</span></div>'}
    </div>`;

  goToStep('step-4');
  startCountdown(hold.seconds_remaining);
}

async function payNow() {
  const d = Object.fromEntries(new FormData($('#confirm-form')).entries());
  $('#confirm-error').textContent = '';

  if (!d.customer_name || !d.customer_name.trim()) {
    $('#confirm-error').textContent = 'Please tell us your name.';
    return;
  }

  try {
    const result = await api(`/api/public/bookings/${state.hold.id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ customer_name: d.customer_name, contact: d.contact }),
    });
    stopCountdown();

    $('#done-text').innerHTML = `Thanks ${escapeHtml(d.customer_name)} —
      <strong>${escapeHtml(result.space)}</strong> is yours from
      ${fmtDate(state.hold.start_date)} to ${fmtDate(state.hold.end_date)}.`;
    $('#payment-stub').innerHTML = `
      <div class="notice info-notice payment-stub">
        <strong>Payment isn't connected yet.</strong>
        This is where the card or UPI step will go${result.amount ? `, for ${money(result.amount)}` : ''}.
        The booking is recorded either way.
      </div>`;
    state.hold = null;
    goToStep('step-done');
  } catch (err) {
    if (err.expired) {
      $('#expired-text').textContent = err.message +
        " We only hold a space for a couple of minutes so it doesn't sit blocked for everyone else. Nothing has been charged.";
      expireHold();
      return;
    }
    $('#confirm-error').textContent = err.message;
  }
}

// ---- Actions ----
const actions = {
  async 'to-step-2'() {
    const { start_date } = dateInputs();
    if (!start_date) { toast('Pick a start date', 'err'); return; }
    await loadSpacesForDates();
    goToStep('step-2');
  },

  'back-to-1': () => goToStep('step-1'),
  'back-to-2': () => goToStep('step-2'),

  choose(id) {
    const space = state.spaces.find(s => s.id === Number(id));
    if (!space || !space.available) return;
    state.chosen = space;
    renderChosenBar();
    renderFit();
    goToStep('step-3');
  },

  async 'to-checkout'() {
    if (!state.chosen) { toast('Pick a space first', 'err'); return; }
    const { item } = currentItem();
    if (!item) { toast('Tell us how many items and roughly what size', 'err'); return; }
    try {
      await beginCheckout();
    } catch (err) {
      toast(err.message, 'err');
      await loadSpacesForDates();
      goToStep('step-2');
    }
  },

  async 'cancel-hold'() {
    stopCountdown();
    if (state.hold) {
      await api(`/api/public/holds/${state.hold.id}/release`, { method: 'POST' }).catch(() => {});
      state.hold = null;
    }
    await loadSpacesForDates();
    goToStep('step-2');
  },

  pay: () => payNow(),

  async 'start-over'() {
    state.chosen = null;
    state.hold = null;
    await loadSpacesForDates();
    goToStep('step-2');
  },
};

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const handler = actions[btn.dataset.action];
  if (!handler) return;
  e.preventDefault();
  Promise.resolve(handler(btn.dataset.id)).catch(err => toast(err.message, 'err'));
});

// ---- Start ----
document.addEventListener('DOMContentLoaded', async () => {
  $('#goods-preset').innerHTML = ITEM_PRESETS
    .map(p => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  $('#dates-form').start_date.value = todayStr();
  renderDatesSummary();

  initStage();

  $('#dates-form').addEventListener('input', renderDatesSummary);
  $('#dates-form').addEventListener('submit', e => e.preventDefault());

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
  $('#confirm-form').addEventListener('submit', e => e.preventDefault());

  try {
    state.planImage = (await api('/api/public/plan-image')).data_url;
  } catch (err) {
    toast(err.message, 'err');
  }
});
