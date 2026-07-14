// Plate — popup logic
const STORAGE_KEY = 'clips';

const listEl   = document.getElementById('list');
const searchEl = document.getElementById('search');
const tallyEl  = document.getElementById('tally');
const segments = Array.from(document.querySelectorAll('.segment'));

let clips = [];
let view = 'plate';        // 'plate' | 'archive' | 'all'
let query = '';
let editingId = null;      // which clip's why-line is open for editing

init();

async function init() {
  clips = await getClips();
  render();

  searchEl.addEventListener('input', () => {
    query = searchEl.value.trim();
    render();
  });

  segments.forEach((btn) => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      segments.forEach((b) => b.classList.toggle('is-active', b === btn));
      render();
    });
  });

  // Reflect changes made elsewhere (e.g. a new save while popup is open).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      clips = changes[STORAGE_KEY].newValue || [];
      render();
    }
  });
}

/* ---------- storage ---------- */
function getClips() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (r) => resolve(r[STORAGE_KEY] || []));
  });
}
function saveClips() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: clips }, resolve);
  });
}

/* ---------- data ops ---------- */
async function toggleArchive(id) {
  const c = clips.find((x) => x.id === id);
  if (!c) return;
  c.archived = !c.archived;
  await saveClips();
  render();
}

async function remove(id) {
  const c = clips.find((x) => x.id === id);
  const label = c && c.archived ? 'Remove this clip from your archive?' : 'Delete this clip?';
  if (!window.confirm(label)) return;
  clips = clips.filter((x) => x.id !== id);
  await saveClips();
  render();
}

async function setWhy(id, value) {
  const c = clips.find((x) => x.id === id);
  if (!c) return;
  c.why = value.trim();
  await saveClips();
}

/* ---------- rendering ---------- */
function visibleClips() {
  let items = clips;
  if (view === 'plate') items = items.filter((c) => !c.archived);
  else if (view === 'archive') items = items.filter((c) => c.archived);

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

function render() {
  const plateCount = clips.filter((c) => !c.archived).length;
  tallyEl.textContent = plateCount
    ? `${plateCount} on your plate`
    : (clips.length ? 'plate cleared' : '');

  const items = visibleClips();
  listEl.innerHTML = '';

  if (items.length === 0) {
    listEl.appendChild(emptyState(plateCount));
    return;
  }
  items.forEach((c) => listEl.appendChild(card(c)));
}

function emptyState(plateCount) {
  const el = document.createElement('div');
  el.className = 'empty';

  if (query) {
    el.innerHTML = `
      <div class="plate-mark"></div>
      <h3>Nothing matches</h3>
      <p>No clips contain “${escapeHtml(query)}”. Try a shorter word.</p>`;
    return el;
  }
  if (view === 'archive') {
    el.innerHTML = `
      <div class="plate-mark"></div>
      <h3>Archive is empty</h3>
      <p>Clips you mark done land here, still searchable.</p>`;
    return el;
  }
  if (view === 'all') {
    el.innerHTML = `
      <div class="plate-mark"></div>
      <h3>No clips yet</h3>
      <p>Highlight a line on any page and save it from the right-click menu.</p>`;
    return el;
  }
  // plate view, empty
  el.className = 'empty cleared';
  el.innerHTML = `
    <div class="plate-mark"></div>
    <h3>${plateCount === 0 && clips.length ? 'Plate cleared' : 'Your plate is empty'}</h3>
    <p>${plateCount === 0 && clips.length
      ? 'Nice. Everything’s been dealt with.'
      : 'Highlight a line on any page and save it from the right-click menu.'}</p>`;
  return el;
}

function card(c) {
  const el = document.createElement('article');
  el.className = 'card' + (c.archived ? ' archived' : '');

  // quote
  const quote = document.createElement('p');
  quote.className = 'quote';
  quote.innerHTML = highlight(c.text || '');
  el.appendChild(quote);

  // meta: source + time
  const meta = document.createElement('div');
  meta.className = 'meta';
  const src = document.createElement('a');
  src.className = 'source';
  src.href = c.url || '#';
  src.target = '_blank';
  src.rel = 'noopener';
  src.title = c.url || '';
  src.innerHTML = highlight(c.title || c.url || 'Untitled');
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = relTime(c.createdAt);
  meta.appendChild(src);
  meta.appendChild(time);
  el.appendChild(meta);

  // why-line (inline editable)
  el.appendChild(whyBlock(c));

  // actions
  const actions = document.createElement('div');
  actions.className = 'actions';

  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'btn' + (c.archived ? '' : ' primary');
  archiveBtn.textContent = c.archived ? 'Back to plate' : 'Done';
  archiveBtn.addEventListener('click', () => toggleArchive(c.id));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn ghost-danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => remove(c.id));

  actions.appendChild(archiveBtn);
  actions.appendChild(delBtn);
  el.appendChild(actions);

  return el;
}

function whyBlock(c) {
  if (editingId === c.id) {
    const ta = document.createElement('textarea');
    ta.className = 'why-edit';
    ta.value = c.why || '';
    ta.placeholder = 'Why did you save this?';
    // defer focus until it's in the DOM
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
  why.className = 'why' + (has ? '' : ' empty');
  why.innerHTML = has ? highlight(c.why) : 'Add a note — why you saved it';
  why.title = 'Click to edit';
  why.addEventListener('click', () => { editingId = c.id; render(); });
  return why;
}

/* ---------- helpers ---------- */
function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape, then wrap query matches in <mark>.
function highlight(str) {
  const safe = escapeHtml(str);
  if (!query) return safe;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return safe.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
  } catch {
    return safe;
  }
}
