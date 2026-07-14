// Plate — popup logic
// Three views: serve (default when something is servable), list (v1 lists),
// inbox (paste self-texts). All writes go through PlateStore; all pure rules
// live in PlateLogic. Never persist a stale in-memory array.

const L = globalThis.PlateLogic;
const store = PlateStore.createStore(chrome.storage.local, navigator.locks);

const headerEl   = document.getElementById('header');
const searchWrap = document.getElementById('searchWrap');
const segmentsEl = document.getElementById('segments');
const mainEl     = document.getElementById('main');
const bannerEl   = document.getElementById('banner');
const hintEl     = document.getElementById('hint');
const tallyEl    = document.getElementById('tally');
const searchEl   = document.getElementById('search');
const inboxBtn   = document.getElementById('inboxBtn');
const backBtn    = document.getElementById('backBtn');
const segments   = Array.from(document.querySelectorAll('.segment'));

const LIST_RENDER_CAP = 200;
const UNDO_MS = 3000;
const REWARD_MS = 700;

let clips = [];
let view = 'serve';        // 'serve' | 'list' | 'inbox'
let listView = 'plate';    // 'plate' | 'archive' | 'all'
let query = '';
let editingId = null;      // which clip's why-line is open for editing
let servedId = null;       // clip currently on the serve card
let undoState = null;      // { label, undo:fn, timer }
let inboxCandidates = [];  // annotated candidates in the inbox view
let searchTimer = null;
let parseTimer = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

init();

async function init() {
  clips = await store.readClips();

  // Popup-open is the resurfacing exposure denominator (plan F2/F5).
  store.mutateStats((s) => { s.popupOpens += 1; return s; }).catch(() => {});

  view = L.plateCounts(clips, Date.now()).servable > 0 ? 'serve' : 'list';
  render();

  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = searchEl.value.trim();
      render();
    }, 150);
  });

  segments.forEach((btn) => {
    btn.addEventListener('click', () => {
      listView = btn.dataset.view;
      view = 'list';
      render();
    });
  });

  inboxBtn.addEventListener('click', () => { view = 'inbox'; inboxCandidates = []; render(); });
  backBtn.addEventListener('click', () => { view = 'list'; render(); });

  document.addEventListener('keydown', onKeydown);

  // Reflect changes made elsewhere (e.g. a context-menu save while open).
  // Always adopt the event value; only an open note editor's draft survives.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[PlateStore.CLIPS_KEY]) return;
    const v = changes[PlateStore.CLIPS_KEY].newValue;
    clips = Array.isArray(v) ? v : [];
    const draft = captureEditorDraft();
    render();
    restoreEditorDraft(draft);
  });
}

/* ---------- keyboard ---------- */
function onKeydown(e) {
  // Shortcuts never fire while typing (design pass 6).
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
    if (e.key === 'Escape' && view === 'inbox' && t.id === 'inboxText') { view = 'list'; render(); }
    return;
  }
  if (e.key === 'Escape' && view === 'inbox') { view = 'list'; render(); return; }
  if (view !== 'serve' || !servedId) return;
  const clip = clips.find((c) => c.id === servedId);
  if (!clip) return;
  if (e.key === 'd') serveDone(clip);
  else if (e.key === 'n') serveNotToday(clip);
  else if (e.key === 'o') serveOpen(clip);
}

/* ---------- editor draft preservation (eng A-4) ---------- */
function captureEditorDraft() {
  if (!editingId) return null;
  const ta = mainEl.querySelector('.why-edit');
  if (!ta) return null;
  return { id: editingId, value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
}
function restoreEditorDraft(draft) {
  if (!draft || editingId !== draft.id) return;
  const ta = mainEl.querySelector('.why-edit');
  if (!ta) return;
  ta.value = draft.value;
  ta.setSelectionRange(draft.start, draft.end);
}

/* ---------- banner ---------- */
function showBanner(text, kind = 'ok', ms = 4000) {
  bannerEl.textContent = text;
  bannerEl.className = `banner ${kind}`;
  bannerEl.hidden = false;
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => { bannerEl.hidden = true; }, ms);
}
function saveFailed(e) {
  console.warn('Plate: save failed', e);
  showBanner("Couldn't save. Storage may be full.", 'danger', 6000);
}

/* ---------- undo (commit-immediately, undo compensates — eng E-2) ---------- */
function offerUndo(label, undoFn) {
  clearUndo();
  const bar = document.createElement('div');
  bar.className = 'undo-bar';
  bar.innerHTML = `<span>${L.escapeHtml(label)}</span>`;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Undo';
  btn.addEventListener('click', async () => {
    clearUndo();
    try { await undoFn(); } catch (e) { saveFailed(e); }
  });
  bar.appendChild(btn);
  mainEl.prepend(bar);
  undoState = { timer: setTimeout(clearUndo, UNDO_MS) };
}
function clearUndo() {
  if (undoState) clearTimeout(undoState.timer);
  undoState = null;
  const bar = mainEl.querySelector('.undo-bar');
  if (bar) bar.remove();
}

/* ---------- data ops ---------- */
async function doneClip(clip) {
  const now = Date.now();
  let didArchive = false;
  try {
    clips = await store.mutateClip(clip.id, (c) => {
      const r = L.applyToggleArchive(c, now);
      didArchive = r.didArchive;
      return r.clip;
    });
  } catch (e) { saveFailed(e); return false; }
  if (didArchive) store.mutateStats((s) => L.recordDone(s, now)).catch(() => {});
  return didArchive;
}

async function unarchiveClip(id) {
  const now = Date.now();
  try {
    clips = await store.mutateClip(id, (c) => L.applyToggleArchive(c, now).clip);
  } catch (e) { saveFailed(e); }
}

async function remove(id) {
  const c = clips.find((x) => x.id === id);
  const label = c && c.archived ? 'Remove this clip from your archive?' : 'Delete this clip?';
  if (!window.confirm(label)) return;
  try {
    clips = await store.removeClip(id);
  } catch (e) { saveFailed(e); return; }
  render();
}

async function setWhy(id, value) {
  try {
    clips = await store.mutateClip(id, (c) => ({ ...c, why: value.trim(), updatedAt: Date.now() }));
  } catch (e) { saveFailed(e); }
}

/* ---------- serve actions ---------- */
async function serveDone(clip) {
  const ok = await doneClip(clip);
  if (!ok) return;
  const card = mainEl.querySelector('.serve-card');
  if (card) card.classList.add('rewarded');
  setTimeout(() => {
    render();
    offerUndo('Done', async () => {
      await unarchiveClip(clip.id);
      await store.mutateStats((s) => L.recordUndoDone(s, Date.now())).catch(() => {});
      render();
    });
  }, reducedMotion ? 0 : REWARD_MS);
}

async function serveNotToday(clip) {
  const now = Date.now();
  try {
    clips = await store.mutateClip(clip.id, (c) => L.applySnooze(c, now));
  } catch (e) { saveFailed(e); return; }
  const card = mainEl.querySelector('.serve-card');
  if (card) {
    card.classList.add('resting');
    const note = document.createElement('p');
    note.className = 'rest-note';
    note.textContent = 'Resting until tomorrow';
    card.appendChild(note);
  }
  setTimeout(() => {
    render();
    offerUndo('Resting until tomorrow', async () => {
      try {
        clips = await store.mutateClip(clip.id, (c) => ({ ...c, snoozedUntil: undefined, updatedAt: Date.now() }));
      } catch (e) { saveFailed(e); }
      render();
    });
  }, reducedMotion ? 0 : REWARD_MS);
}

function serveOpen(clip) {
  const href = L.safeHref(clip.url);
  if (href) chrome.tabs.create({ url: href }); // popup closes; same clip serves next open
}

/* ---------- inbox actions ---------- */
function parseInboxInput(text) {
  const parsed = L.parseInbox(text);
  inboxCandidates = L.dedupeCandidates(parsed.candidates, clips).map((c) => ({
    ...c,
    checked: c.status === 'ok'
  }));
  inboxCandidates.total = parsed.total;
  inboxCandidates.capped = parsed.capped;
  renderInboxCandidates();
}

async function inboxAdd() {
  const picked = inboxCandidates.filter((c) => c.checked);
  if (!picked.length) return;
  const now = Date.now();
  const newClips = picked.map((c, i) =>
    L.makeClip({
      text: c.text,
      url: c.kind === 'link' ? c.url : '',
      title: c.kind === 'link' ? c.url : 'From phone inbox',
      now,
      offset: i
    })
  );
  try {
    clips = await store.prependClips(newClips);
  } catch (e) { saveFailed(e); return; }
  store.mutateStats((s) => {
    s.inboxSessions += 1;
    s.inboxClipsAdded += newClips.length;
    return s;
  }).catch(() => {});
  view = 'list';
  listView = 'plate';
  render();
  showBanner(`${newClips.length} added — they'll come back to you`, 'ok');
}

/* ---------- rendering ---------- */
function render() {
  const now = Date.now();
  const counts = L.plateCounts(clips, now);

  tallyEl.textContent = counts.plate
    ? `${counts.plate} on your plate`
    : (clips.length ? 'plate cleared' : '');

  // Header chrome: full in list view, collapsed elsewhere (design F1).
  const listMode = view === 'list';
  searchWrap.hidden = !listMode;
  segmentsEl.hidden = !listMode;
  inboxBtn.hidden = !listMode;
  backBtn.hidden = view !== 'inbox';
  segments.forEach((b) => b.classList.toggle('is-active', b.dataset.view === listView));

  clearUndoIfStale();
  mainEl.innerHTML = '';

  if (view === 'serve') renderServe(now, counts);
  else if (view === 'inbox') renderInbox();
  else renderList(now);

  renderFooter(now);
}

function clearUndoIfStale() {
  // undo bar is re-prepended by offerUndo after render when active
  if (!undoState) {
    const bar = mainEl.querySelector('.undo-bar');
    if (bar) bar.remove();
  }
}

/* ---- serve view ---- */
function renderServe(now, counts) {
  const clip = L.pickServeClip(clips, now);
  if (!clip) {
    if (counts.plate > 0) {
      // all snoozed — the plate rests
      mainEl.appendChild(emptyBlock('rests', 'The plate rests until tomorrow',
        'Everything left is snoozed. It comes back in the morning.', true));
    } else {
      view = 'list';
      renderList(now);
    }
    return;
  }
  servedId = clip.id;

  const card = document.createElement('article');
  card.className = 'card serve-card';

  const quote = document.createElement('p');
  quote.className = 'serve-quote';
  quote.innerHTML = L.escapeHtml(clip.text || '');
  card.appendChild(quote);

  card.appendChild(whyBlock(clip));

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.appendChild(sourceLink(clip));
  const age = document.createElement('span');
  age.className = 'age';
  age.textContent = L.ageLabel(clip.createdAt, now);
  meta.appendChild(age);
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'actions serve-actions';
  const doneBtn = mkBtn('Done', 'btn primary', () => serveDone(clip));
  const openBtn = mkBtn('Open page', 'btn', () => serveOpen(clip));
  const notBtn  = mkBtn('Not today', 'btn ghost', () => serveNotToday(clip));
  actions.append(doneBtn, openBtn, notBtn);
  card.appendChild(actions);

  mainEl.appendChild(card);

  const escape = document.createElement('button');
  escape.className = 'show-plate';
  escape.textContent = 'show the full plate';
  escape.addEventListener('click', () => { view = 'list'; listView = 'plate'; render(); });
  mainEl.appendChild(escape);
}

/* ---- list view (v1, capped + age labels) ---- */
function visibleClips() {
  let items = clips;
  if (listView === 'plate') items = items.filter((c) => !c.archived);
  else if (listView === 'archive') items = items.filter((c) => c.archived);

  if (query) {
    const q = query.toLowerCase();
    items = items.filter((c) =>
      (c.text  || '').toLowerCase().includes(q) ||
      (c.why   || '').toLowerCase().includes(q) ||
      (c.title || '').toLowerCase().includes(q) ||
      (c.url   || '').toLowerCase().includes(q)
    );
  }
  return items;
}

function renderList(now) {
  const items = visibleClips();
  if (items.length === 0) {
    mainEl.appendChild(listEmptyState());
    return;
  }
  const shown = items.slice(0, LIST_RENDER_CAP);
  shown.forEach((c) => mainEl.appendChild(card(c, now)));
  if (items.length > shown.length) {
    const cap = document.createElement('p');
    cap.className = 'cap-note';
    cap.textContent = `Showing ${shown.length} of ${items.length} — search to narrow down.`;
    mainEl.appendChild(cap);
  }
}

function listEmptyState() {
  const plateCount = clips.filter((c) => !c.archived).length;
  const el = document.createElement('div');
  el.className = 'empty';
  if (query) {
    el.innerHTML = `<div class="plate-mark"></div><h3>Nothing matches</h3>
      <p>No clips contain “${L.escapeHtml(query)}”. Try a shorter word.</p>`;
    return el;
  }
  if (listView === 'archive') {
    el.innerHTML = `<div class="plate-mark"></div><h3>Archive is empty</h3>
      <p>Clips you mark done land here, still searchable.</p>`;
    return el;
  }
  if (listView === 'all') {
    el.innerHTML = `<div class="plate-mark"></div><h3>No clips yet</h3>
      <p>Highlight a line on any page and save it from the right-click menu.</p>`;
    return el;
  }
  el.className = 'empty cleared';
  el.innerHTML = `<div class="plate-mark"></div>
    <h3>${plateCount === 0 && clips.length ? 'Plate cleared' : 'Your plate is empty'}</h3>
    <p>${plateCount === 0 && clips.length
      ? 'Nice. Everything’s been dealt with.'
      : 'Highlight a line on any page and save it from the right-click menu.'}</p>`;
  return el;
}

function emptyBlock(kind, title, text, withPlateLink) {
  const el = document.createElement('div');
  el.className = `empty ${kind}`;
  el.innerHTML = `<div class="plate-mark"></div><h3>${L.escapeHtml(title)}</h3><p>${L.escapeHtml(text)}</p>`;
  if (withPlateLink) {
    const link = document.createElement('button');
    link.className = 'show-plate';
    link.textContent = 'show the full plate';
    link.addEventListener('click', () => { view = 'list'; listView = 'plate'; render(); });
    el.appendChild(link);
  }
  return el;
}

function card(c, now) {
  const el = document.createElement('article');
  el.className = 'card' + (c.archived ? ' archived' : '');

  const quote = document.createElement('p');
  quote.className = 'quote';
  quote.innerHTML = highlight(c.text || '');
  el.appendChild(quote);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.appendChild(sourceLink(c, true));
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = c.archived ? L.relTime(c.createdAt, now) : L.ageLabel(c.createdAt, now);
  meta.appendChild(time);
  el.appendChild(meta);

  el.appendChild(whyBlock(c));

  const actions = document.createElement('div');
  actions.className = 'actions';
  const archiveBtn = mkBtn(c.archived ? 'Back to plate' : 'Done',
    'btn' + (c.archived ? '' : ' primary'),
    async () => {
      if (c.archived) await unarchiveClip(c.id);
      else await doneClip(c);
      render();
    });
  const delBtn = mkBtn('Delete', 'btn ghost-danger', () => remove(c.id));
  actions.append(archiveBtn, delBtn);
  el.appendChild(actions);

  return el;
}

function sourceLink(c, withHighlight) {
  const src = document.createElement('a');
  src.className = 'source';
  const href = L.safeHref(c.url);
  if (href) {
    src.href = href;
    src.target = '_blank';
    src.rel = 'noopener';
  }
  src.title = c.url || '';
  const label = c.title || c.url || 'Untitled';
  src.innerHTML = withHighlight ? highlight(label) : L.escapeHtml(label);
  return src;
}

function mkBtn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function whyBlock(c) {
  if (editingId === c.id) {
    const ta = document.createElement('textarea');
    ta.className = 'why-edit';
    ta.value = c.why || '';
    ta.placeholder = 'Why did you save this?';
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    const commit = async () => {
      await setWhy(c.id, ta.value);
      editingId = null;
      render();
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ta.blur(); }
      if (e.key === 'Escape') { editingId = null; render(); }
    });
    return ta;
  }
  const why = document.createElement('div');
  const has = (c.why || '').length > 0;
  why.className = 'why' + (has ? '' : ' empty'); // .empty = unseasoned (dotted olive border)
  why.innerHTML = has ? highlight(c.why) : 'Add a note — why you saved it';
  why.title = 'Click to edit';
  why.addEventListener('click', () => { editingId = c.id; render(); });
  return why;
}

/* ---- inbox view ---- */
function renderInbox() {
  servedId = null;
  const wrap = document.createElement('div');
  wrap.className = 'inbox';

  const ta = document.createElement('textarea');
  ta.id = 'inboxText';
  ta.className = 'inbox-text';
  ta.placeholder = 'Paste your self-texts — one clip per line';
  ta.addEventListener('input', () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => parseInboxInput(ta.value), 120);
  });
  wrap.appendChild(ta);

  const list = document.createElement('div');
  list.className = 'inbox-candidates';
  list.id = 'inboxCandidates';
  wrap.appendChild(list);

  const foot = document.createElement('div');
  foot.className = 'inbox-foot';
  const add = document.createElement('button');
  add.id = 'inboxAdd';
  add.className = 'btn primary';
  add.disabled = true;
  add.textContent = 'Add 0 to plate';
  add.addEventListener('click', inboxAdd);
  foot.appendChild(add);
  wrap.appendChild(foot);

  mainEl.appendChild(wrap);
  setTimeout(() => ta.focus(), 0);
  renderInboxCandidates();
}

function renderInboxCandidates() {
  const list = document.getElementById('inboxCandidates');
  const add = document.getElementById('inboxAdd');
  if (!list || !add) return;
  list.innerHTML = '';

  const cands = inboxCandidates;
  if (cands.length) {
    const allDuped = cands.every((c) => c.status !== 'ok');
    if (allDuped) {
      const p = document.createElement('p');
      p.className = 'cap-note';
      p.textContent = 'All of these are already on your plate.';
      list.appendChild(p);
    }
    cands.forEach((cand, i) => {
      const row = document.createElement('label');
      row.className = 'inbox-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cand.checked;
      cb.addEventListener('change', () => {
        cand.checked = cb.checked;
        updateAddButton();
      });
      row.appendChild(cb);
      const txt = document.createElement('span');
      txt.className = 'inbox-line';
      txt.innerHTML = L.escapeHtml(cand.text);
      row.appendChild(txt);
      if (cand.status !== 'ok') {
        const tag = document.createElement('em');
        tag.className = 'inbox-tag';
        tag.textContent = cand.status === 'already-saved' ? 'already saved' : 'duplicate in paste';
        row.appendChild(tag);
      }
      list.appendChild(row);
    });
    if (cands.capped) {
      const p = document.createElement('p');
      p.className = 'cap-note';
      p.textContent = `Showing 200 of ${cands.total} lines.`;
      list.appendChild(p);
    }
  }
  updateAddButton();

  function updateAddButton() {
    const n = cands.filter((c) => c.checked).length;
    add.disabled = n === 0;
    add.textContent = `Add ${n} to plate`;
  }
}

/* ---- footer (contextual — one job per view) ---- */
function renderFooter(now) {
  if (view === 'serve') {
    hintEl.innerHTML = '<b>d</b> done &nbsp;·&nbsp; <b>n</b> not today &nbsp;·&nbsp; <b>o</b> open page';
  } else if (view === 'inbox') {
    hintEl.innerHTML = 'Paste from Messages, WhatsApp, or wherever you text yourself. <b>Esc</b> to go back.';
  } else if (listView === 'plate') {
    hintEl.innerHTML = 'Select text on any page, right-click → <b>Save selection to Plate</b>';
  } else {
    const s = statsLine(now);
    hintEl.textContent = s;
  }
}

let cachedStats = null;
function statsLine(now) {
  if (cachedStats) return formatStats(cachedStats, now);
  store.readStats().then((s) => { cachedStats = s; renderFooter(now); }).catch(() => {});
  return '…';
}
function formatStats(s, now) {
  const week = L.isoWeekKey(now);
  const dones = s.donesByWeek[week] || 0;
  const fill = L.noteFillRate(clips);
  return `${dones} done this week · ${fill.withNote}/${fill.total} clips noted · ${s.inboxSessions} inbox sessions`;
}

/* ---------- helpers ---------- */
// Escape, then wrap query matches in <mark>.
function highlight(str) {
  const safe = L.escapeHtml(str);
  if (!query) return safe;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return safe.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
  } catch {
    return safe;
  }
}
