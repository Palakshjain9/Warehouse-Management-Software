/* The split-layout booking page. Same server, same rules as /book — only the
   layout differs: dates and the plan share one screen, and the rail on the right
   carries whatever needs saying about what's been picked. */

const CURRENCY = '₹';
const LOCALE = 'en-IN';
const LONG_PRESS_MS = 450;
const DATE_DEBOUNCE_MS = 250;

const $ = (sel, root = document) => root.querySelector(sel);

// Below this the two columns can't both fit, so the rail becomes a bottom sheet
// and the plan is sized by width instead of height.
const WIDE = window.matchMedia('(min-width: 861px)');

const state = {
  spaces: [],
  planImage: null,
  planAspect: null,
  range: null,
  chosen: [],
  detail: null,
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

const STAGE_NUMBER = { 'stage-pick': 1, 'stage-goods': 2, 'stage-checkout': 3 };

function goToStage(id) {
  document.querySelectorAll('.stage').forEach(s => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  const current = STAGE_NUMBER[id] ?? 4;
  document.querySelectorAll('.steps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('current', n === current);
    li.classList.toggle('done', n < current);
  });
  // A hidden pane measures zero, so the plan can only be sized once it's on screen.
  sizeFrames();
  fitSheet();
  window.scrollTo({ top: 0 });
}

// ---- Dates ----
function dateInputs() {
  const days = Math.max(1, Math.floor(Number($('#f-days').value) || 1));
  return { start: $('#f-start').value, days };
}

let dateTimer = null;
let dateRequest = 0;

function scheduleDateReload() {
  clearTimeout(dateTimer);
  dateTimer = setTimeout(() => {
    loadSpacesForDates().catch(err => toast(err.message, 'err'));
  }, DATE_DEBOUNCE_MS);
}

async function loadSpacesForDates() {
  const { start, days } = dateInputs();
  if (!start) { $('#date-note').textContent = 'Pick a start date to see what’s available.'; return; }

  // Typing in a date field fires off a request per keystroke; only the newest answer counts.
  const ticket = ++dateRequest;
  const data = await api(`/api/public/spaces?start=${start}&days=${days}`);
  if (ticket !== dateRequest) return;

  state.spaces = data.spaces;
  state.range = { start: data.start, days: data.days, end: data.end };

  // Dropping a pick that has gone unavailable for the new dates.
  state.chosen = state.chosen
    .map(c => state.spaces.find(s => s.id === c.id))
    .filter(s => s && s.available);

  if (state.detail) state.detail = state.spaces.find(s => s.id === state.detail.id) || null;

  const free = data.spaces.filter(s => s.available).length;
  $('#date-note').innerHTML = `${fmtDate(data.start)} to ${fmtDate(data.end)} &middot;
    <strong>${free}</strong> of ${data.spaces.length} available`;

  renderPlan();
  renderSpaceList();
  renderDetail();
  renderPicks();
}

// ---- The plan ----
function renderPlan() {
  const holder = $('#plan-holder');

  if (!state.planImage) {
    holder.innerHTML = `<div class="empty-state">
      <h2>The plan isn't up yet</h2>
      <p>The layout drawing hasn't been uploaded. Please check back shortly.</p>
    </div>`;
    return;
  }

  // No name label on free spaces — the owner's drawing already carries the names,
  // and an overlay label would sit on top of them.
  const boxes = state.spaces.map(s => {
    const picked = isChosen(s);
    const cls = picked ? 'is-chosen' : s.available ? 'is-free' : 'is-taken';
    return `<div class="hot-box pickable ${cls}" data-space-id="${s.id}"
        style="left:${s.hot_x * 100}%;top:${s.hot_y * 100}%;width:${s.hot_w * 100}%;height:${s.hot_h * 100}%">
        ${picked ? `<span>${escapeHtml(s.name)}</span>` : ''}
      </div>`;
  }).join('');

  drawPlan(holder, boxes);
}

// The same drawing on the checkout stage, marked with nothing but what's on hold.
function renderCheckoutPlan() {
  const holder = $('#checkout-plan');
  if (!state.planImage || !state.hold) { holder.innerHTML = ''; return; }

  const held = new Set(state.hold.spaces.map(s => s.name));
  const boxes = state.spaces.filter(s => held.has(s.name)).map(s =>
    `<div class="hot-box is-chosen"
        style="left:${s.hot_x * 100}%;top:${s.hot_y * 100}%;width:${s.hot_w * 100}%;height:${s.hot_h * 100}%">
        <span>${escapeHtml(s.name)}</span>
      </div>`).join('');

  drawPlan(holder, boxes);
}

function drawPlan(holder, boxes) {
  holder.innerHTML = `<div class="plan-frame">
      <img src="${state.planImage}" alt="Basement layout">
      ${boxes}
    </div>`;

  const img = holder.querySelector('img');
  if (img.complete && img.naturalHeight) {
    state.planAspect = img.naturalWidth / img.naturalHeight;
    sizeFrames();
  } else {
    img.addEventListener('load', () => {
      state.planAspect = img.naturalWidth / img.naturalHeight;
      sizeFrames();
    }, { once: true });
  }
}

// The sheet at the bottom of a phone screen floats over the page, so the page
// needs exactly that much padding underneath or the last row can't be scrolled
// clear of it.
function fitSheet() {
  const split = document.querySelector('.stage.active .split');
  if (!split) return;
  if (WIDE.matches) {
    split.style.paddingBottom = '';
    document.documentElement.style.setProperty('--sheet-h', '0px');
    return;
  }
  const rail = split.querySelector('.pane-right');
  if (!rail) return;
  const height = Math.ceil(rail.getBoundingClientRect().height);
  split.style.paddingBottom = `${height + 16}px`;
  // Anything scrolled into view has to clear the sheet as well.
  document.documentElement.style.setProperty('--sheet-h', `${height}px`);
}

// On a wide screen the drawing has to fit the space left over beside the rail, so
// the frame is given the widest size that still fits under the holder's height.
// On a phone the CSS sizes it by width and the inline width comes off.
function sizeFrames() {
  document.querySelectorAll('.plan-holder').forEach(holder => {
    const frame = holder.querySelector('.plan-frame');
    if (!frame) return;
    if (!WIDE.matches || !state.planAspect) { frame.style.width = ''; return; }

    const css = getComputedStyle(holder);
    const availW = holder.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const availH = holder.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    if (availW <= 0 || availH <= 0) return;

    frame.style.width = `${Math.floor(Math.min(availW, availH * state.planAspect))}px`;
  });
}

// ---- The same spaces as a list, for thumbs that miss on a hand-drawn plan ----
function renderSpaceList() {
  $('#space-list').innerHTML = state.spaces.map(s => {
    const picked = isChosen(s);
    const cls = !s.available ? 'space-row gone' : picked ? 'space-row added' : 'space-row';
    const action = !s.available
      ? '<span class="badge occupied">Booked</span>'
      : picked
        ? `<button data-action="unchoose" data-id="${s.id}">Remove</button>`
        : `<button class="primary" data-action="choose" data-id="${s.id}">Add</button>`;
    return `<div class="${cls}" data-space-id="${s.id}">
        <div class="who">
          <div class="nm">${escapeHtml(s.name)}</div>
          <div class="mt">${whole(s.size_sqft)} sq ft · ${usableHeight(s)} ft usable</div>
        </div>
        ${s.price_per_day ? `<div class="pr">${money(s.price_per_day)}<div class="mt">per day</div></div>` : ''}
        ${action}
      </div>`;
  }).join('');
}

// ---- The rail on the pick stage ----
function renderDetail() {
  const box = $('#space-detail');
  const space = state.detail;

  if (!space) {
    box.innerHTML = `<div class="card">
        <h3>Pick a space</h3>
        <p class="muted-line">Tap an area on the plan to add it — tap more than one if you
        need the room. Its floor area, usable height and price show up here.</p>
      </div>`;
    return;
  }

  const days = state.range?.days ?? 1;
  box.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(space.name)}
        <span class="badge ${space.available ? 'vacant' : 'occupied'}">${space.available ? 'Available' : 'Booked'}</span>
      </h3>
      <div class="facts">
        <div><span>Floor area</span><strong>${whole(space.size_sqft)} sq ft</strong></div>
        <div><span>Usable height</span><strong>${usableHeight(space)} ft</strong></div>
        <div><span>Footprint</span><strong>${space.length_ft} × ${space.width_ft} ft</strong></div>
        ${space.price_per_day ? `<div><span>Price</span><strong>${money(space.price_per_day)} / day</strong></div>` : ''}
      </div>
      ${space.available
        ? isChosen(space)
          ? `<button class="detail-btn" data-action="unchoose" data-id="${space.id}">Remove from your picks</button>`
          : `<button class="primary detail-btn" data-action="choose" data-id="${space.id}">
               Add${space.price_per_day ? ` — ${money(space.price_per_day * days)} for ${plural(days, 'day')}` : ''}
             </button>`
        : '<p class="muted-line">Someone has this one for the dates you picked. Try another space, or change your dates.</p>'}
    </div>`;
}

function totalPrice() {
  return state.chosen.reduce((sum, s) => sum + (Number(s.price_per_day) || 0), 0)
    * (state.range?.days || 1);
}

// The picks and their running total, without the card wrapper — the rail shows
// this on the pick stage and again beside the goods questions.
function picksInner(heading) {
  const days = state.range?.days ?? 1;
  const rows = state.chosen.map(s => `
    <div class="pick-row">
      <div>${escapeHtml(s.name)}<div class="sub">${whole(s.size_sqft)} sq ft · ${usableHeight(s)} ft usable</div></div>
      <div>${s.price_per_day ? money(s.price_per_day * days) : ''}</div>
    </div>`).join('');

  return `<h3>${heading}</h3>
    ${rows}
    <div class="total-row">
      <span>${plural(days, 'day')}</span>
      <span class="big">${totalPrice() ? money(totalPrice()) : '—'}</span>
    </div>`;
}

function renderPicks() {
  const box = $('#picks-card');
  const btn = $('#to-goods');
  btn.disabled = state.chosen.length === 0;

  if (!state.chosen.length) {
    box.innerHTML = '';
    btn.textContent = 'Continue';
    return;
  }

  btn.textContent = `Continue with ${plural(state.chosen.length, 'space')}`;
  box.innerHTML = `<div class="card">${picksInner('Your picks')}</div>`;
}

function toggleChoice(space) {
  state.chosen = isChosen(space)
    ? state.chosen.filter(c => c.id !== space.id)
    : [...state.chosen, space];
  renderPlan();
  renderSpaceList();
  renderDetail();
  renderPicks();
}

// A long press shows the facts without picking; a short tap picks the space.
let pressTimer = null;
let pressHandled = false;

function initPlan() {
  const holder = $('#plan-holder');

  holder.addEventListener('pointerdown', e => {
    const box = e.target.closest('.hot-box');
    if (!box) return;
    pressHandled = false;
    const space = state.spaces.find(s => s.id === Number(box.dataset.spaceId));
    pressTimer = setTimeout(() => {
      pressHandled = true;
      state.detail = space;
      renderDetail();
    }, LONG_PRESS_MS);
  });

  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  holder.addEventListener('pointermove', cancelPress);
  holder.addEventListener('pointercancel', cancelPress);
  holder.addEventListener('pointerleave', cancelPress);

  holder.addEventListener('pointerup', e => {
    clearTimeout(pressTimer);
    const box = e.target.closest('.hot-box');
    if (!box || pressHandled) return;

    const space = state.spaces.find(s => s.id === Number(box.dataset.spaceId));
    if (!space) return;
    state.detail = space;
    if (space.available) toggleChoice(space);
    else renderDetail();
  });

  // Tapping a row in the list shows the same detail the plan would.
  $('#space-list').addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const row = e.target.closest('.space-row');
    if (!row) return;
    state.detail = state.spaces.find(s => s.id === Number(row.dataset.spaceId)) || null;
    renderDetail();
  });
}

// ---- Goods ----
function renderItemGrid() {
  const chosenId = $('#f-preset').value;
  $('#item-grid').innerHTML = ITEM_PRESETS.map(p => `
    <button type="button" class="item-card${p.id === chosenId ? ' selected' : ''}"
            data-action="pick-item" data-id="${p.id}">
      <img src="${p.image}" alt="" loading="lazy">
      <span class="item-name">${escapeHtml(p.name)}</span>
      <span class="item-size">${escapeHtml(p.size)}</span>
    </button>`).join('');
}

function currentItem() {
  const preset = presetById($('#f-preset').value);
  const quantity = $('#f-qty').value;

  if ($('#f-exact').checked) {
    return {
      item: makeItem({
        l: $('#f-l').value, w: $('#f-w').value, h: $('#f-h').value,
        unit: $('#f-unit').value, quantity,
      }),
      label: preset && preset.id !== 'custom' ? preset.name : 'items',
      exact: true,
    };
  }

  if (!preset || preset.id === 'custom') return { item: null, label: 'items', exact: false };
  return {
    item: makeItem({ l: preset.l, w: preset.w, h: preset.h, unit: 'm', quantity }),
    label: preset.name,
    exact: false,
  };
}

function fillExactFromPreset(preset) {
  if (!preset || preset.id === 'custom') return;
  $('#f-unit').value = 'm';
  $('#f-l').value = preset.l;
  $('#f-w').value = preset.w;
  $('#f-h').value = preset.h;
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
        `${escapeHtml(p.space.name)} about ${whole(p.cap.capacity)}`).join(' · ')}</div>`
    : '';

  if (capacity >= item.qty) {
    box.innerHTML = `<div class="notice ok-notice">
        <strong>That should fit.</strong>
        ${across} roughly ${whole(capacity)} of these, and you have ${whole(item.qty)} — ${basis}.
        ${breakdown}
      </div>`;
    return;
  }

  state.fit.warning = `Might not fit: holds about ${whole(capacity)}, needs ${whole(item.qty)}`;
  box.innerHTML = `<div class="notice warn-notice">
      <strong>This might be tight.</strong>
      ${across} roughly ${whole(capacity)} of these, and you're planning on ${whole(item.qty)} — ${basis}.
      ${exact
        ? 'You can still go ahead, but you may want another space.'
        : 'If you know the exact size of one item, tick the box and we can be more precise.'}
      ${breakdown}
    </div>`;
}

// ---- Checkout, against the clock ----
function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function renderCountdown(secondsLeft) {
  const el = $('#hold-timer');
  if (secondsLeft <= 0) { el.innerHTML = ''; return; }
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
  goToStage('stage-expired');
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

  $('#pay-error').textContent = '';
  const perSpace = hold.spaces.length > 1
    ? `<div class="calc-row"><span></span><span class="muted-inline">${hold.spaces
        .map(s => `${escapeHtml(s.name)} ${money(s.amount)}`).join(' · ')}</span></div>`
    : '';

  $('#order-summary').innerHTML = `
    <div class="calc-block">
      <div class="calc-row"><span>Space${hold.spaces.length > 1 ? 's' : ''}</span><span>${escapeHtml(hold.spaces.map(s => s.name).join(', '))}</span></div>
      <div class="calc-row"><span>Dates</span><span>${fmtDate(hold.start_date)} to ${fmtDate(hold.end_date)}</span></div>
      <div class="calc-row"><span>Storing</span><span>${item ? `${whole(item.qty)} × ${escapeHtml(label)}` : '—'}</span></div>
      ${state.fit?.warning ? `<div class="calc-row"><span>Note</span><span class="balance-positive">${escapeHtml(state.fit.warning)}</span></div>` : ''}
      ${perSpace}
      ${hold.amount
        ? `<div class="calc-row calc-total"><span>To pay for ${plural(hold.days, 'day')}</span><span>${money(hold.amount)}</span></div>`
        : '<div class="calc-row"><span>Price</span><span>We’ll confirm it with you</span></div>'}
    </div>`;

  goToStage('stage-checkout');
  renderCheckoutPlan();
  startCountdown(hold.seconds_remaining);
}

async function payNow() {
  const name = $('#f-name').value.trim();
  const contact = $('#f-phone').value.trim();
  const email = $('#f-email').value.trim();
  $('#pay-error').textContent = '';

  if (!name) { $('#pay-error').textContent = 'Please tell us your name.'; return; }
  if (!contact && !email) {
    $('#pay-error').textContent = 'Please leave a mobile number or an email so we can reach you.';
    return;
  }

  try {
    const result = await api(`/api/public/holds/${state.hold.group_id}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        customer_name: name, contact, email, whatsapp: $('#f-wa').checked,
      }),
    });
    stopCountdown();

    const names = result.spaces.join(', ');
    $('#done-text').innerHTML = `Thanks ${escapeHtml(name)} —
      <strong>${escapeHtml(names)}</strong> ${result.spaces.length > 1 ? 'are' : 'is'} yours from
      ${fmtDate(state.hold.start_date)} to ${fmtDate(state.hold.end_date)}.`;
    $('#done-extra').innerHTML = `
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
    state.detail = null;
    goToStage('stage-done');
  } catch (err) {
    if (err.expired) {
      $('#expired-text').textContent = `${err.message} We only hold spaces for a few minutes so they don't sit blocked for everyone else. Nothing has been charged.`;
      expireHold();
      return;
    }
    $('#pay-error').textContent = err.message;
  }
}

// ---- Actions ----
const actions = {
  choose(id) {
    const space = state.spaces.find(s => s.id === Number(id));
    if (!space || !space.available || isChosen(space)) return;
    state.detail = space;
    toggleChoice(space);
  },

  unchoose(id) {
    const space = state.spaces.find(s => s.id === Number(id));
    if (!space) return;
    state.detail = space;
    toggleChoice(space);
  },

  'to-goods'() {
    if (!state.chosen.length) { toast('Pick at least one space', 'err'); return; }
    $('#goods-picks').innerHTML = picksInner('Your picks');
    renderItemGrid();
    renderFit();
    goToStage('stage-goods');
  },

  'back-to-pick': () => goToStage('stage-pick'),

  'pick-item'(id) {
    $('#f-preset').value = id;
    const preset = presetById(id);
    if (id === 'custom' && !$('#f-exact').checked) {
      $('#f-exact').checked = true;
      $('#exact-row').classList.remove('hidden');
    }
    if ($('#f-exact').checked) fillExactFromPreset(preset);
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
      goToStage('stage-pick');
    }
  },

  async 'cancel-hold'() {
    stopCountdown();
    if (state.hold) {
      await api(`/api/public/holds/${state.hold.group_id}/release`, { method: 'POST' }).catch(() => {});
      state.hold = null;
    }
    await loadSpacesForDates();
    goToStage('stage-pick');
  },

  pay: () => payNow(),

  async 'start-over'() {
    state.chosen = [];
    state.detail = null;
    state.hold = null;
    await loadSpacesForDates();
    goToStage('stage-pick');
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
  $('#f-start').value = todayStr();
  renderItemGrid();
  renderDetail();
  initPlan();

  // Only `input` — a `change` listener fires on blur, which re-renders and can
  // destroy the button being clicked before its click ever lands.
  $('#f-start').addEventListener('input', scheduleDateReload);
  $('#f-days').addEventListener('input', scheduleDateReload);

  document.querySelectorAll('#f-qty, #f-exact, #f-l, #f-w, #f-h, #f-unit').forEach(el => {
    el.addEventListener('input', () => {
      if (el.id === 'f-exact') {
        $('#exact-row').classList.toggle('hidden', !el.checked);
        if (el.checked && !$('#f-l').value) fillExactFromPreset(presetById($('#f-preset').value));
      }
      renderFit();
    });
  });

  window.addEventListener('resize', () => { sizeFrames(); fitSheet(); });

  // The sheet changes height whenever a card goes in or out of it.
  if (window.ResizeObserver) {
    const watcher = new ResizeObserver(fitSheet);
    document.querySelectorAll('.pane-right').forEach(rail => watcher.observe(rail));
  }

  try {
    state.planImage = (await api('/api/public/plan-image')).data_url;
  } catch (err) {
    toast(err.message, 'err');
  }

  await loadSpacesForDates().catch(err => toast(err.message, 'err'));
});
