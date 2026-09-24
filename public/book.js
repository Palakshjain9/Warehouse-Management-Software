const CURRENCY = '₹';
const LOCALE = 'en-IN';
const LONG_PRESS_MS = 450;

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  spaces: [],
  planImage: null,
  range: null,
  chosen: [],
  fit: null,
  hold: null,
};

const isChosen = (space) => state.chosen.some(c => c.id === space.id);
const chosenNames = () => state.chosen.map(c => c.name).join(', ');

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

  // Dropping a pick that has gone unavailable for the new dates.
  state.chosen = state.chosen
    .map(c => state.spaces.find(s => s.id === c.id))
    .filter(s => s && s.available);

  $('#dates-bar').innerHTML = `
    <strong>${fmtDate(data.start)} to ${fmtDate(data.end)}</strong>
    <span class="muted-inline">${data.days} day${data.days === 1 ? '' : 's'} ·
      ${data.spaces.filter(s => s.available).length} of ${data.spaces.length} available</span>`;
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
    const picked = isChosen(s);
    const cls = picked ? 'is-chosen' : s.available ? 'is-free' : 'is-taken';
    return `<div class="hot-box pickable ${cls}" data-space-id="${s.id}"
        style="left:${s.hot_x * 100}%;top:${s.hot_y * 100}%;width:${s.hot_w * 100}%;height:${s.hot_h * 100}%">
        ${picked ? `<span>${escapeHtml(s.name)}</span>` : ''}
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
        <div><span>Usable height</span><strong>${usableHeight(space)} ft</strong></div>
        <div><span>Footprint</span><strong>${space.length_ft} × ${space.width_ft} ft</strong></div>
        ${space.price_per_day ? `<div><span>Price</span><strong>${money(space.price_per_day)} / day</strong></div>` : ''}
      </div>
      ${space.available
        ? isChosen(space)
          ? `<button data-action="unchoose" data-id="${space.id}">Remove ${escapeHtml(space.name)} from your picks</button>`
          : `<button class="primary" data-action="choose" data-id="${space.id}">
               Add ${escapeHtml(space.name)}${space.price_per_day ? ` — ${money(space.price_per_day * nights)} for ${nights} day${nights === 1 ? '' : 's'}` : ''}
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
    if (space.available) toggleChoice(space);
    renderStage();
    renderDetail(space);
  });
}

function toggleChoice(space) {
  state.chosen = isChosen(space)
    ? state.chosen.filter(c => c.id !== space.id)
    : [...state.chosen, space];
  renderSelection();
}

function totalPrice() {
  return state.chosen.reduce((sum, s) => sum + (Number(s.price_per_day) || 0), 0)
    * (state.range?.days || 1);
}

function renderSelection() {
  const bar = $('#selection-bar');
  const btn = $('#continue-btn');
  btn.disabled = state.chosen.length === 0;

  if (!state.chosen.length) {
    bar.innerHTML = '';
    btn.textContent = 'Continue';
    return;
  }

  const area = state.chosen.reduce((sum, s) => sum + Number(s.size_sqft || 0), 0);
  btn.textContent = `Continue with ${state.chosen.length} space${state.chosen.length === 1 ? '' : 's'}`;
  bar.innerHTML = `
    <div class="selection-summary">
      <div>
        <strong>${escapeHtml(chosenNames())}</strong>
        <span class="muted-inline">${whole(area)} sq ft together \u00b7
          ${state.range.days} day${state.range.days === 1 ? '' : 's'}</span>
      </div>
      <div class="selection-total">${totalPrice() ? money(totalPrice()) : ''}</div>
    </div>`;
}

// ---- Step 3: goods ----
function goodsInputs() {
  return Object.fromEntries(new FormData($('#goods-form')).entries());
}

function renderItemGrid() {
  const chosenId = $('#goods-preset').value;
  $('#goods-grid').innerHTML = ITEM_PRESETS.map(p => `
    <button type="button" class="item-card${p.id === chosenId ? ' selected' : ''}"
            data-action="pick-item" data-id="${p.id}">
      <img src="${p.image}" alt="" loading="lazy">
      <span class="item-name">${escapeHtml(p.name)}</span>
      <span class="item-size">${escapeHtml(p.size)}</span>
    </button>`).join('');
}

function currentItem() {
  const d = goodsInputs();
  const preset = presetById(d.preset);

  if ($('#exact-toggle').checked) {
    return {
      item: makeItem({ l: d.item_l, w: d.item_w, h: d.item_h, unit: d.dim_unit, quantity: d.quantity }),
      label: preset && preset.id !== 'custom' ? preset.name : 'items',
      exact: true,
    };
  }

  if (!preset || preset.id === 'custom') return { item: null, label: 'items', exact: false };
  return {
    item: makeItem({ l: preset.l, w: preset.w, h: preset.h, unit: 'm', quantity: d.quantity }),
    label: preset.name,
    exact: false,
  };
}

function renderFit() {
  const box = $('#fit-verdict');
  const { item, exact } = currentItem();
  state.fit = null;

  if (!state.chosen.length) { box.innerHTML = ''; return; }
  if (!item) {
    box.innerHTML = `<div class="notice info-notice">
      Tell us roughly how big one item is and we'll check it against your picks.
    </div>`;
    return;
  }

  // Capacity is summed across every space picked, since the load can be split between them.
  const per = state.chosen.map(s => ({ space: s, cap: spaceCapacity(s, item) }));
  const capacity = per.reduce((sum, p) => sum + p.cap.capacity, 0);
  state.fit = { capacity, qty: item.qty, exact };

  const basis = exact ? 'based on the size you gave us' : 'based on a typical size for that kind of item';
  const across = state.chosen.length > 1
    ? `${escapeHtml(chosenNames())} together hold`
    : `${escapeHtml(state.chosen[0].name)} holds`;
  const breakdown = state.chosen.length > 1
    ? `<div class="fit-breakdown">${per.map(p =>
        `${escapeHtml(p.space.name)} about ${whole(p.cap.capacity)}`).join(' \u00b7 ')}</div>`
    : '';

  if (capacity >= item.qty) {
    box.innerHTML = `<div class="notice ok-notice">
        <strong>That should fit.</strong>
        ${across} roughly ${whole(capacity)} of these, and you have ${whole(item.qty)} \u2014 ${basis}.
        ${breakdown}
      </div>`;
    return;
  }

  state.fit.warning = `Might not fit: holds about ${whole(capacity)}, needs ${whole(item.qty)}`;
  box.innerHTML = `<div class="notice warn-notice">
      <strong>This might be tight.</strong>
      ${across} roughly ${whole(capacity)} of these, and you're planning on ${whole(item.qty)} \u2014 ${basis}.
      ${exact
        ? 'You can still go ahead, but you may want another space.'
        : 'If you know the exact size of one item, tick the box above and we can be more precise.'}
      ${breakdown}
    </div>`;
}

function renderChosenBar() {
  if (!state.chosen.length) { $('#chosen-bar').innerHTML = ''; return; }
  const area = state.chosen.reduce((sum, s) => sum + Number(s.size_sqft || 0), 0);
  $('#chosen-bar').innerHTML = `<strong>${escapeHtml(chosenNames())}</strong>
     <span class="muted-inline">${whole(area)} sq ft ·
     ${usableHeight(state.chosen[0])} ft usable height ·
     ${fmtDate(state.range.start)} to ${fmtDate(state.range.end)}</span>`;
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
  el.className = `hold-timer${secondsLeft <= 60 ? ' urgent' : ''}`;
  const names = state.hold.spaces.map(s => s.name).join(', ');
  el.innerHTML = `We're holding ${escapeHtml(names)} for you —
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
  const hold = await api('/api/public/holds', {
    method: 'POST',
    body: JSON.stringify({
      space_ids: state.chosen.map(s => s.id),
      start_date: state.range.start,
      days: state.range.days,
      quantity: item?.qty ?? null,
      item_label: label,
      item_l_ft: item?.l ?? null,
      item_w_ft: item?.w ?? null,
      item_h_ft: item?.h ?? null,
      estimated_capacity: state.fit?.capacity ?? null,
      fit_warning: state.fit?.warning ?? null,
    }),
  });
  state.hold = hold;

  $('#confirm-error').textContent = '';
  const perSpace = hold.spaces.length > 1
    ? `<div class="calc-row"><span></span><span class="muted-inline">${hold.spaces
        .map(s => `${escapeHtml(s.name)} ${money(s.amount)}`).join(' \u00b7 ')}</span></div>`
    : '';

  $('#summary').innerHTML = `
    <div class="calc-block">
      <div class="calc-row"><span>Space${hold.spaces.length > 1 ? 's' : ''}</span><span>${escapeHtml(hold.spaces.map(s => s.name).join(', '))}</span></div>
      <div class="calc-row"><span>Dates</span><span>${fmtDate(hold.start_date)} to ${fmtDate(hold.end_date)}</span></div>
      <div class="calc-row"><span>Storing</span><span>${item ? `${whole(item.qty)} \u00d7 ${escapeHtml(label)}` : '\u2014'}</span></div>
      ${state.fit?.warning ? `<div class="calc-row"><span>Note</span><span class="balance-positive">${escapeHtml(state.fit.warning)}</span></div>` : ''}
      ${perSpace}
      ${hold.amount
        ? `<div class="calc-row calc-total"><span>To pay for ${hold.days} day${hold.days === 1 ? '' : 's'}</span><span>${money(hold.amount)}</span></div>`
        : '<div class="calc-row"><span>Price</span><span>We\u2019ll confirm it with you</span></div>'}
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
  if (!d.contact && !d.email) {
    $('#confirm-error').textContent = 'Please leave a mobile number or an email so we can reach you.';
    return;
  }

  try {
    const result = await api(`/api/public/holds/${state.hold.group_id}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        customer_name: d.customer_name,
        contact: d.contact,
        email: d.email,
        whatsapp: !!d.whatsapp,
      }),
    });
    stopCountdown();

    const names = result.spaces.join(', ');
    $('#done-text').innerHTML = `Thanks ${escapeHtml(d.customer_name)} —
      <strong>${escapeHtml(names)}</strong> ${result.spaces.length > 1 ? 'are' : 'is'} yours from
      ${fmtDate(state.hold.start_date)} to ${fmtDate(state.hold.end_date)}.`;
    $('#payment-stub').innerHTML = `
      <div class="notice info-notice payment-stub">
        <strong>Payment isn't connected yet.</strong>
        This is where the card or UPI step will go${result.amount ? `, for ${money(result.amount)}` : ''}.
        The booking is recorded either way.
      </div>
      <div class="notice info-notice payment-stub">
        Remember that loading and unloading charges are settled directly with the labour.
      </div>`;
    state.hold = null;
    state.chosen = [];
    goToStep('step-done');
  } catch (err) {
    if (err.expired) {
      $('#expired-text').textContent = `${err.message} We only hold spaces for a few minutes so they don't sit blocked for everyone else. Nothing has been charged.`;
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
    if (!space || !space.available || isChosen(space)) return;
    toggleChoice(space);
    renderStage();
    renderDetail(space);
  },

  unchoose(id) {
    const space = state.spaces.find(s => s.id === Number(id));
    if (!space) return;
    toggleChoice(space);
    renderStage();
    renderDetail(space);
  },

  'to-goods'() {
    if (!state.chosen.length) { toast('Pick at least one space', 'err'); return; }
    renderChosenBar();
    renderItemGrid();
    renderFit();
    goToStep('step-3');
  },

  'pick-item'(id) {
    $('#goods-preset').value = id;
    const preset = presetById(id);
    const form = $('#goods-form');
    if (id === 'custom' && !$('#exact-toggle').checked) {
      $('#exact-toggle').checked = true;
      $('#exact-fields').classList.remove('hidden');
    }
    if (preset && preset.id !== 'custom' && $('#exact-toggle').checked) {
      form.dim_unit.value = 'm';
      form.item_l.value = preset.l;
      form.item_w.value = preset.w;
      form.item_h.value = preset.h;
    }
    renderItemGrid();
    renderFit();
  },

  async 'to-checkout'() {
    if (!state.chosen.length) { toast('Pick a space first', 'err'); return; }
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
      await api(`/api/public/holds/${state.hold.group_id}/release`, { method: 'POST' }).catch(() => {});
      state.hold = null;
    }
    await loadSpacesForDates();
    goToStep('step-2');
  },

  pay: () => payNow(),

  async 'start-over'() {
    state.chosen = [];
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
  renderItemGrid();
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
