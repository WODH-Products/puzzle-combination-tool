/* Puzzle Combination Studio
 * A password-gated browser for 600 action x payoff puzzle combinations.
 * The library ships encrypted; the password derives the AES key that opens it.
 */
(() => {
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(...args); }, ms); };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORE_KEY = 'pcs.prefs.v1';
const THEME_KEY = 'pcs.theme';
const PASS_KEY = 'pcs.pass';
const UI_KEY = 'pcs.ui.v1';
const VAULT_URL = 'data/vault.json';

/* ---------------------------------------------------------------- state -- */

const state = {
  data: null,          // { actions, payoffs, rows }
  rows: [],            // indexed rows
  view: 'browse',      // browse | favourites | matrix | shuffle
  page: 0,
  pageSize: 24,
  listView: false,
  filters: { fav: false, rated: false, noted: false, unseen: false },
  filtered: [],
  cursor: -1,          // keyboard-focused card index within the page
  shuffleId: null,
  detailId: null,
};

const prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { favourites: {}, ratings: {}, notes: {}, tags: {}, seen: {}, ...parsed };
    }
  } catch (_) { /* storage may be blocked */ }
  return { favourites: {}, ratings: {}, notes: {}, tags: {}, seen: {} };
}

function savePrefs() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); }
  catch (_) { toast('This browser is blocking local storage, so changes will not be remembered.'); }
}

const isFav = (id) => Boolean(prefs.favourites[id]);
const ratingOf = (id) => prefs.ratings[id] || 0;
const noteOf = (id) => prefs.notes[id] || '';
const tagsOf = (id) => prefs.tags[id] || [];

/* ----------------------------------------------------------------- misc -- */

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}
try { applyTheme(localStorage.getItem(THEME_KEY) || 'system'); } catch (_) {}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function highlight(text, terms) {
  const safe = escapeHtml(text);
  if (!terms.length) return safe;
  const pattern = terms
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!pattern) return safe;
  return safe.replace(new RegExp('(' + pattern + ')', 'gi'), '<mark>$1</mark>');
}

const pad = (n) => String(n).padStart(3, '0');

function download(filename, text, type) {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------- unlocking -- */

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function decryptVault(vault, password) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(vault.kdf.salt), iterations: vault.kdf.iterations, hash: vault.kdf.hash },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(vault.iv) }, key, b64ToBytes(vault.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

let vaultPromise = null;
const getVault = () => (vaultPromise ||= fetch(VAULT_URL, { cache: 'no-cache' }).then((r) => {
  if (!r.ok) throw new Error('Could not load the encrypted library (' + r.status + ').');
  return r.json();
}));

async function attemptUnlock(password, { silent = false } = {}) {
  const vault = await getVault();
  const data = await decryptVault(vault, password);   // throws if the password is wrong
  startApp(data);
  if (!silent) toast('Unlocked ' + data.rows.length + ' combinations.');
}

function rememberPassword(password, persist) {
  try {
    sessionStorage.setItem(PASS_KEY, password);
    if (persist) localStorage.setItem(PASS_KEY, password);
  } catch (_) {}
}

function forgetPassword() {
  try { sessionStorage.removeItem(PASS_KEY); localStorage.removeItem(PASS_KEY); } catch (_) {}
}

/* -------------------------------------------------------------- gate UI -- */

const gateForm = $('#gate-form');
const gateError = $('#gate-error');

gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#password').value;
  const button = $('#unlock');
  gateError.textContent = '';
  button.disabled = true;
  button.textContent = 'Unlocking…';
  try {
    await attemptUnlock(password);
    rememberPassword(password, $('#remember').checked);
  } catch (error) {
    const network = error instanceof TypeError || /library/.test(error.message);
    gateError.textContent = network
      ? 'The encrypted library could not be loaded. Serve this page over http, not from a file:// path.'
      : 'That password does not open the library. Try again.';
    $('#password').select();
  } finally {
    button.disabled = false;
    button.textContent = 'Unlock';
  }
});

$('#toggle-pw').addEventListener('click', () => {
  const input = $('#password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#toggle-pw').textContent = show ? 'Hide' : 'Show';
  input.focus();
});

(async function autoUnlock() {
  let saved = null;
  try { saved = sessionStorage.getItem(PASS_KEY) || localStorage.getItem(PASS_KEY); } catch (_) {}
  if (!saved) return;
  try { await attemptUnlock(saved, { silent: true }); }
  catch (_) { forgetPassword(); }
})();

/* ------------------------------------------------------------ app start -- */

function saveUiState() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({
      query: $('#query').value, action: $('#action').value, payoff: $('#payoff').value,
      sort: $('#sort').value, pageSize: state.pageSize, listView: state.listView,
      filters: state.filters, view: state.view === 'favourites' ? 'favourites' : 'browse',
    }));
  } catch (_) {}
}

function restoreUiState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch (_) {}
  if (!saved) return null;
  $('#query').value = saved.query || '';
  $('#action').value = saved.action || '';
  $('#payoff').value = saved.payoff || '';
  $('#sort').value = saved.sort || 'id';
  state.pageSize = saved.pageSize || 24;
  $('#page-size').value = String(state.pageSize);
  state.listView = Boolean(saved.listView);
  $('#view-toggle').textContent = state.listView ? 'Card view' : 'List view';
  Object.assign(state.filters, saved.filters || {});
  $$('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(Boolean(state.filters[chip.dataset.filter]))));
  return saved;
}

/* A link like …/index.html#c=241 opens that combination once unlocked. */
function linkedCombination() {
  const match = /[#&]c=(\d{1,3})\b/.exec(location.hash);
  const id = match ? Number(match[1]) : 0;
  return id >= 1 && id <= 600 ? id : 0;
}

function startApp(data) {
  state.data = data;
  state.rows = data.rows.map((row) => ({
    ...row,
    search: [pad(row.id), row.actionShort, row.payoffShort, row.action, row.payoff, row.idea].join(' ').toLowerCase(),
  }));

  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#password').value = '';

  const actionSel = $('#action');
  const payoffSel = $('#payoff');
  if (actionSel.options.length === 1) {
    data.actions.forEach((a, i) => actionSel.add(new Option((i + 1) + '. ' + a[0], String(i + 1))));
    data.payoffs.forEach((p, i) => payoffSel.add(new Option((i + 31) + '. ' + p[0], String(i + 31))));
  }

  const saved = restoreUiState();
  buildMatrix();
  if (saved && saved.view === 'favourites') setView('favourites'); else render();
  document.addEventListener('keydown', onKeydown);

  const linked = linkedCombination();
  if (linked) openDetail(linked);
  window.addEventListener('hashchange', () => {
    const id = linkedCombination();
    if (id) openDetail(id);
  });
}

/* ------------------------------------------------------------ filtering -- */

function currentTerms() {
  return $('#query').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function computeFiltered() {
  const terms = currentTerms();
  const actionId = Number($('#action').value) || 0;
  const payoffId = Number($('#payoff').value) || 0;
  const f = state.filters;
  const favouritesTab = state.view === 'favourites';

  let rows = state.rows.filter((row) => {
    if (actionId && row.actionId !== actionId) return false;
    if (payoffId && row.payoffId !== payoffId) return false;
    if (favouritesTab && !isFav(row.id)) return false;
    if (f.fav && !isFav(row.id)) return false;
    if (f.rated && !ratingOf(row.id)) return false;
    if (f.noted && !noteOf(row.id).trim()) return false;
    if (f.unseen && prefs.seen[row.id]) return false;
    return terms.every((t) => row.search.includes(t));
  });

  const sort = $('#sort').value;
  const byName = (a, b, key) => a[key].localeCompare(b[key]) || a.id - b.id;
  if (sort === 'rating') rows.sort((a, b) => ratingOf(b.id) - ratingOf(a.id) || a.id - b.id);
  else if (sort === 'recent') rows.sort((a, b) => (prefs.favourites[b.id] || 0) - (prefs.favourites[a.id] || 0) || a.id - b.id);
  else if (sort === 'action') rows.sort((a, b) => byName(a, b, 'actionShort'));
  else if (sort === 'payoff') rows.sort((a, b) => byName(a, b, 'payoffShort'));
  else if (sort === 'random') rows = shuffleArray(rows);
  else rows.sort((a, b) => a.id - b.id);

  state.filtered = rows;
  return rows;
}

function shuffleArray(input) {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* --------------------------------------------------------------- render -- */

function render() {
  const rows = computeFiltered();
  const terms = currentTerms();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(Math.max(0, state.page), pages - 1);
  const start = state.page * state.pageSize;
  const slice = rows.slice(start, start + state.pageSize);

  const results = $('#results');
  results.classList.toggle('list-view', state.listView);
  const fragment = document.createDocumentFragment();
  slice.forEach((row) => fragment.append(buildCard(row, terms)));

  if (!slice.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = state.view === 'favourites' && !rows.length
      ? '<h3>No favourites yet</h3><p>Open Browse and press the star on any combination worth keeping.</p>'
      : '<h3>Nothing matches</h3><p>Try a different word, or clear the filters.</p>';
    fragment.append(empty);
  }
  results.replaceChildren(fragment);

  $('#count').innerHTML = rows.length
    ? '<b>' + rows.length + '</b> ' + (rows.length === 1 ? 'combination' : 'combinations')
      + (rows.length > slice.length ? ' · showing ' + (start + 1) + '–' + (start + slice.length) : '')
    : '0 combinations';
  $('#pagenum').textContent = 'Page ' + (state.page + 1) + ' of ' + pages;
  $('[data-page="prev"]').disabled = state.page === 0;
  $('[data-page="next"]').disabled = state.page >= pages - 1;
  $('#pager').hidden = pages === 1 && rows.length <= 24;

  renderStats();
  state.cursor = -1;
}

function renderStats() {
  const favCount = Object.keys(prefs.favourites).length;
  const rated = Object.keys(prefs.ratings).filter((k) => prefs.ratings[k]).length;
  const noted = Object.keys(prefs.notes).filter((k) => prefs.notes[k].trim()).length;
  const seen = Object.keys(prefs.seen).length;
  const items = [
    ['600', 'combinations'],
    [String(favCount), 'favourites'],
    [String(rated), 'rated'],
    [String(noted), 'with notes'],
    [Math.round((seen / 600) * 100) + '%', 'reviewed'],
  ];
  $('#stats').innerHTML = items.map(([b, s]) => '<div class="stat"><b>' + b + '</b><span>' + s + '</span></div>').join('');
  $('#tab-fav-count').textContent = favCount ? String(favCount) : '';
}

function buildCard(row, terms) {
  const card = document.createElement('article');
  card.className = 'card' + (isFav(row.id) ? ' is-fav' : '');
  card.dataset.id = String(row.id);
  card.tabIndex = -1;

  const rating = ratingOf(row.id);
  const note = noteOf(row.id).trim();
  const tags = tagsOf(row.id);

  card.innerHTML =
    '<div class="card-top">' +
      '<p class="card-meta">#' + pad(row.id) + ' · Action ' + row.actionId + ' × Payoff ' + row.payoffId + '</p>' +
      '<button class="icon-btn fav-btn" data-act="fav" aria-pressed="' + isFav(row.id) + '" title="Favourite (F)">' + (isFav(row.id) ? '★' : '☆') + '</button>' +
    '</div>' +
    '<h3>' + highlight(row.actionShort, terms) + '<span class="arrow">→</span>' + highlight(row.payoffShort, terms) + '</h3>' +
    '<p class="idea">' + highlight(row.idea, terms) + '</p>' +
    '<p class="payoff-note">Visual payoff: ' + highlight(row.payoff, terms) + '</p>' +
    (tags.length ? '<div class="tagrow">' + tags.map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
    '<div class="card-foot">' +
      '<button class="icon-btn" data-act="open" title="Open details">Details</button>' +
      '<button class="icon-btn' + (note ? ' has-note' : '') + '" data-act="note" title="Notes">' + (note ? '✎ Note' : 'Note') + '</button>' +
      '<button class="icon-btn" data-act="copy" title="Copy this idea">Copy</button>' +
      '<span class="rate" data-rate-for="' + row.id + '">' +
        [1, 2, 3, 4, 5].map((n) => '<button data-act="rate" data-n="' + n + '" class="' + (n <= rating ? 'on' : '') + '" title="Rate ' + n + '">★</button>').join('') +
      '</span>' +
    '</div>';
  return card;
}

/* ------------------------------------------------------------- actions -- */

function markSeen(id) {
  if (!prefs.seen[id]) { prefs.seen[id] = Date.now(); savePrefs(); }
}

function toggleFav(id) {
  if (prefs.favourites[id]) delete prefs.favourites[id];
  else { prefs.favourites[id] = Date.now(); markSeen(id); }
  savePrefs();
  return Boolean(prefs.favourites[id]);
}

function setRating(id, n) {
  if (ratingOf(id) === n) delete prefs.ratings[id];
  else prefs.ratings[id] = n;
  markSeen(id);
  savePrefs();
}

const rowById = (id) => state.rows.find((r) => r.id === Number(id));

function copyRow(row) {
  const text = '#' + pad(row.id) + ' · ' + row.actionShort + ' → ' + row.payoffShort + '\n' + row.idea + '\nVisual payoff: ' + row.payoff;
  navigator.clipboard?.writeText(text).then(() => toast('Copied #' + pad(row.id) + ' to the clipboard.'),
    () => toast('The browser blocked clipboard access.'));
}

$('#results').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-act]');
  const card = event.target.closest('.card');
  if (!card) return;
  const id = Number(card.dataset.id);
  if (!button) return;

  const act = button.dataset.act;
  if (act === 'fav') {
    const on = toggleFav(id);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? '★' : '☆';
    card.classList.toggle('is-fav', on);
    renderStats();
    updateMatrixCell(id);
    if (state.view === 'favourites' && !on) render();
  } else if (act === 'rate') {
    setRating(id, Number(button.dataset.n));
    const rating = ratingOf(id);
    $$('button', button.parentElement).forEach((b, i) => b.classList.toggle('on', i < rating));
    renderStats();
    updateMatrixCell(id);
  } else if (act === 'open' || act === 'note') {
    openDetail(id, act === 'note');
  } else if (act === 'copy') {
    copyRow(rowById(id));
  }
});

/* -------------------------------------------------------------- detail -- */

const detail = $('#detail');

function openDetail(id, focusNote = false) {
  const row = rowById(id);
  if (!row) return;
  if (editingId && editingId !== id) { flushDetailInputs(); refreshCard(editingId); }
  state.detailId = id;
  markSeen(id);
  $('#d-meta').textContent = '#' + pad(row.id) + ' · Action ' + row.actionId + ' × Payoff ' + row.payoffId;
  $('#d-title').innerHTML = escapeHtml(row.actionShort) + '<span class="arrow" style="color:var(--faint);font-weight:400;padding:0 6px">→</span>' + escapeHtml(row.payoffShort);
  $('#d-idea').textContent = row.idea;
  $('#d-detail').textContent = 'Player action: ' + row.action + '  ·  Visual payoff: ' + row.payoff;
  $('#d-note').value = noteOf(id);
  $('#d-tags').value = tagsOf(id).join(', ');
  editingId = id;
  paintDetailControls(id);
  if (!detail.open) detail.showModal();
  if (focusNote) $('#d-note').focus();
  renderStats();
}

function paintDetailControls(id) {
  const rating = ratingOf(id);
  $('#d-rate').innerHTML = [1, 2, 3, 4, 5]
    .map((n) => '<button data-n="' + n + '" class="' + (n <= rating ? 'on' : '') + '" title="Rate ' + n + '">★</button>').join('');
  const fav = isFav(id);
  const favBtn = $('#d-fav');
  favBtn.setAttribute('aria-pressed', String(fav));
  favBtn.textContent = fav ? '★ Favourited' : '☆ Favourite';
}

$('#d-rate').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setRating(state.detailId, Number(b.dataset.n));
  paintDetailControls(state.detailId);
  refreshCard(state.detailId);
});

$('#d-fav').addEventListener('click', () => {
  toggleFav(state.detailId);
  paintDetailControls(state.detailId);
  refreshCard(state.detailId);
});

let editingId = null;

function saveDetailInputs() {
  const id = editingId;
  if (!id) return;
  const note = $('#d-note').value;
  if (note.trim()) prefs.notes[id] = note; else delete prefs.notes[id];
  const tags = $('#d-tags').value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
  if (tags.length) prefs.tags[id] = tags; else delete prefs.tags[id];
  savePrefs();
}

const queueDetailSave = debounce(saveDetailInputs, 400);

function flushDetailInputs() {
  queueDetailSave.cancel();
  saveDetailInputs();
}

$('#d-note').addEventListener('input', queueDetailSave);
$('#d-tags').addEventListener('input', queueDetailSave);


function refreshCard(id) {
  const card = $('.card[data-id="' + id + '"]');
  if (!card) { renderStats(); updateMatrixCell(id); return; }
  const fresh = buildCard(rowById(id), currentTerms());
  card.replaceWith(fresh);
  renderStats();
  updateMatrixCell(id);
}

function stepDetail(delta) {
  const list = state.filtered.length ? state.filtered : state.rows;
  const index = list.findIndex((r) => r.id === state.detailId);
  const next = list[(index + delta + list.length) % list.length];
  if (next) openDetail(next.id);
}

$('#d-prev').addEventListener('click', () => stepDetail(-1));
$('#d-next').addEventListener('click', () => stepDetail(1));
$('#d-copy').addEventListener('click', () => copyRow(rowById(state.detailId)));
$('#d-link').addEventListener('click', () => {
  const url = location.origin + location.pathname + '#c=' + state.detailId;
  navigator.clipboard?.writeText(url).then(() => toast('Link to #' + pad(state.detailId) + ' copied.'),
    () => toast('The browser blocked clipboard access.'));
});
$('#d-close').addEventListener('click', () => detail.close());
detail.addEventListener('close', () => { flushDetailInputs(); refreshCard(state.detailId); editingId = null; });

$('#help-btn').addEventListener('click', () => $('#help').showModal());
$('#help-close').addEventListener('click', () => $('#help').close());

/* --------------------------------------------------------------- matrix -- */

function buildMatrix() {
  const { actions, payoffs } = state.data;
  const head = '<thead><tr><th></th>' + payoffs.map((p, i) => '<th><div>' + (i + 31) + '. ' + escapeHtml(p[0]) + '</div></th>').join('') + '</tr></thead>';
  const body = '<tbody>' + actions.map((a, ai) => {
    const cells = payoffs.map((_, pi) => {
      const id = ai * 20 + pi + 1;
      return '<td><button class="cell" data-id="' + id + '" title="#' + pad(id) + '"></button></td>';
    }).join('');
    return '<tr><th>' + (ai + 1) + '. ' + escapeHtml(a[0]) + '</th>' + cells + '</tr>';
  }).join('') + '</tbody>';
  $('#matrix').innerHTML = head + body;
  $$('#matrix .cell').forEach((cell) => paintCell(cell));
}

function paintCell(cell) {
  const id = Number(cell.dataset.id);
  cell.className = 'cell' + (isFav(id) ? ' fav' : ratingOf(id) ? ' rated' : noteOf(id).trim() ? ' noted' : '');
}

function updateMatrixCell(id) {
  const cell = $('#matrix .cell[data-id="' + id + '"]');
  if (cell) paintCell(cell);
}

$('#matrix').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) openDetail(Number(cell.dataset.id));
});

/* -------------------------------------------------------------- shuffle -- */

function renderShuffle(pickNew = true) {
  const pool = state.filtered.length ? state.filtered : state.rows;
  if (pickNew || !state.shuffleId) state.shuffleId = pool[Math.floor(Math.random() * pool.length)].id;
  const row = rowById(state.shuffleId);
  markSeen(row.id);
  $('#shuffle-card').innerHTML =
    '<p class="card-meta">#' + pad(row.id) + ' · Action ' + row.actionId + ' × Payoff ' + row.payoffId + '</p>' +
    '<h3>' + escapeHtml(row.actionShort) + '<span class="arrow" style="color:var(--faint);font-weight:400;padding:0 8px">→</span>' + escapeHtml(row.payoffShort) + '</h3>' +
    '<p class="idea">' + escapeHtml(row.idea) + '</p>' +
    '<p class="payoff-note">Visual payoff: ' + escapeHtml(row.payoff) + '</p>';
  $('#shuffle-fav').textContent = isFav(row.id) ? '★ Saved' : '☆ Save this one';
  renderStats();
}

$('#shuffle-btn').addEventListener('click', () => renderShuffle(true));
$('#shuffle-fav').addEventListener('click', () => {
  if (!state.shuffleId) return;
  toggleFav(state.shuffleId);
  renderShuffle(false);
  updateMatrixCell(state.shuffleId);
});
$('#shuffle-open').addEventListener('click', () => state.shuffleId && openDetail(state.shuffleId));

/* ----------------------------------------------------------------- tabs -- */

function setView(view) {
  state.view = view;
  state.page = 0;
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  const browse = view === 'browse' || view === 'favourites';
  $('#view-browse').hidden = !browse;
  $('#view-matrix').hidden = view !== 'matrix';
  $('#view-shuffle').hidden = view !== 'shuffle';
  if (browse) {
    $('#hero-eyebrow').textContent = view === 'favourites' ? 'Your shortlist' : 'Puzzle idea library';
    $('#hero-title').textContent = view === 'favourites' ? 'Saved ideas' : 'Action × payoff';
    $('#hero-sub').textContent = view === 'favourites'
      ? 'Everything you have starred, with your ratings and notes attached.'
      : 'Every player action paired with every visual payoff, each with a short idea for connecting the two.';
    render();
  } else if (view === 'matrix') {
    computeFiltered();
    $$('#matrix .cell').forEach(paintCell);
  } else {
    computeFiltered();
    renderShuffle(!state.shuffleId);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => { setView(tab.dataset.view); saveUiState(); }));

/* -------------------------------------------------------------- filters -- */

$('#query').addEventListener('input', debounce(() => { state.page = 0; render(); saveUiState(); }, 140));
['#action', '#payoff', '#sort'].forEach((sel) => $(sel).addEventListener('change', () => { state.page = 0; render(); saveUiState(); }));
$('#page-size').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 0; render(); saveUiState(); });

$('#chipbar').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const key = chip.dataset.filter;
  state.filters[key] = !state.filters[key];
  chip.setAttribute('aria-pressed', String(state.filters[key]));
  state.page = 0;
  render();
  saveUiState();
});

$('#clear-filters').addEventListener('click', () => {
  $('#query').value = '';
  $('#action').value = '';
  $('#payoff').value = '';
  $('#sort').value = 'id';
  Object.keys(state.filters).forEach((k) => { state.filters[k] = false; });
  $$('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  state.page = 0;
  render();
  saveUiState();
});

$$('[data-page]').forEach((btn) => btn.addEventListener('click', () => {
  state.page += btn.dataset.page === 'next' ? 1 : -1;
  render();
  $('.resultbar').scrollIntoView({ block: 'start', behavior: 'smooth' });
}));

$('#view-toggle').addEventListener('click', () => {
  state.listView = !state.listView;
  $('#view-toggle').textContent = state.listView ? 'Card view' : 'List view';
  render();
  saveUiState();
});

$('#theme-btn').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || 'system';
  const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
  applyTheme(next);
  toast('Theme: ' + next);
});

$('#lock-btn').addEventListener('click', () => {
  forgetPassword();
  location.reload();
});

/* --------------------------------------------------------------- export -- */

const exportDialog = $('#export');
$('#export-btn').addEventListener('click', () => exportDialog.showModal());
$('#x-cancel').addEventListener('click', () => exportDialog.close());

$('#x-go').addEventListener('click', () => {
  const format = $('#x-format').value;
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'backup') {
    download('puzzle-studio-backup-' + stamp + '.json', JSON.stringify({ kind: 'pcs-backup', version: 1, savedAt: new Date().toISOString(), prefs }, null, 2), 'application/json');
    exportDialog.close();
    toast('Backup downloaded.');
    return;
  }

  const scope = $('#x-scope').value;
  const rows = scope === 'all' ? state.rows
    : scope === 'fav' ? state.rows.filter((r) => isFav(r.id))
    : state.filtered;

  if (!rows.length) { toast('Nothing to export in that selection.'); return; }

  if (format === 'csv') {
    const quote = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const header = ['id', 'action_id', 'payoff_id', 'action', 'payoff', 'idea', 'payoff_detail', 'favourite', 'rating', 'tags', 'note'];
    const lines = [header.join(',')].concat(rows.map((r) => [
      r.id, r.actionId, r.payoffId, r.actionShort, r.payoffShort, r.idea, r.payoff,
      isFav(r.id) ? 'yes' : '', ratingOf(r.id) || '', tagsOf(r.id).join('; '), noteOf(r.id).replace(/\n/g, ' '),
    ].map(quote).join(',')));
    download('puzzle-combinations-' + scope + '-' + stamp + '.csv', lines.join('\n'), 'text/csv');
  } else if (format === 'md') {
    const body = rows.map((r) => {
      const bits = ['### #' + pad(r.id) + ' · ' + r.actionShort + ' → ' + r.payoffShort, '', r.idea, '', '*Visual payoff: ' + r.payoff + '*'];
      if (ratingOf(r.id)) bits.push('', 'Rating: ' + '★'.repeat(ratingOf(r.id)));
      if (tagsOf(r.id).length) bits.push('', 'Tags: ' + tagsOf(r.id).join(', '));
      if (noteOf(r.id).trim()) bits.push('', '> ' + noteOf(r.id).trim().replace(/\n/g, '\n> '));
      return bits.join('\n');
    }).join('\n\n---\n\n');
    download('puzzle-combinations-' + scope + '-' + stamp + '.md',
      '# Puzzle combinations (' + rows.length + ')\n\nExported ' + stamp + '\n\n' + body + '\n', 'text/markdown');
  } else {
    const payload = rows.map((r) => ({
      id: r.id, actionId: r.actionId, payoffId: r.payoffId, action: r.actionShort, payoff: r.payoffShort,
      idea: r.idea, payoffDetail: r.payoff, favourite: isFav(r.id), rating: ratingOf(r.id) || null,
      tags: tagsOf(r.id), note: noteOf(r.id) || null,
    }));
    download('puzzle-combinations-' + scope + '-' + stamp + '.json', JSON.stringify(payload, null, 2), 'application/json');
  }
  exportDialog.close();
  toast('Exported ' + rows.length + ' combinations.');
});

/* --------------------------------------------------------------- import -- */

$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.prefs || parsed;
    if (!incoming || typeof incoming !== 'object' || !('favourites' in incoming)) throw new Error('shape');
    ['favourites', 'ratings', 'notes', 'tags', 'seen'].forEach((key) => {
      Object.assign(prefs[key], incoming[key] || {});
    });
    savePrefs();
    $$('#matrix .cell').forEach(paintCell);
    render();
    toast('Imported ' + Object.keys(incoming.favourites || {}).length + ' favourites.');
  } catch (_) {
    toast('That file is not a Puzzle Studio backup.');
  } finally {
    event.target.value = '';
  }
});

/* ------------------------------------------------------------ shortcuts -- */

function focusCard(index) {
  const cards = $$('#results .card');
  if (!cards.length) return;
  state.cursor = Math.max(0, Math.min(index, cards.length - 1));
  const card = cards[state.cursor];
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function onKeydown(event) {
  const tag = event.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const dialogOpen = detail.open || $('#help').open || exportDialog.open;

  if (event.key === '/' && !typing) { event.preventDefault(); $('#query').focus(); return; }
  if (event.key === '?' && !typing) { event.preventDefault(); $('#help').showModal(); return; }
  if (typing || dialogOpen) return;

  const key = event.key.toLowerCase();
  if (key === 'j') { event.preventDefault(); focusCard(state.cursor + 1); }
  else if (key === 'k') { event.preventDefault(); focusCard(state.cursor - 1); }
  else if (key === 'r') { setView('shuffle'); renderShuffle(true); }
  else if (key === 'arrowright') { $('[data-page="next"]').click(); }
  else if (key === 'arrowleft') { $('[data-page="prev"]').click(); }
  else {
    const card = event.target.closest?.('.card');
    if (!card) return;
    const id = Number(card.dataset.id);
    if (key === 'f') { event.preventDefault(); toggleFav(id); refreshCard(id); focusCard(state.cursor); }
    else if (key === 'enter') { event.preventDefault(); openDetail(id); }
    else if (/^[1-5]$/.test(key)) { event.preventDefault(); setRating(id, Number(key)); refreshCard(id); focusCard(state.cursor); }
  }
}

})();
