// Plate — background service worker
// Right-click "Save selection to Plate", badge count + staleness color.
// All clip writes go through PlateStore (locks-wrapped) — never write
// chrome.storage directly from here.

importScripts('logic.js', 'storage.js');

const store = PlateStore.createStore(chrome.storage.local, navigator.locks);
const PLATE_GREEN = '#3D5A40';
const SAVED_GREEN = '#3F9142';
const STALE_AMBER = '#C88A3A'; // doubles as the save-error flash color
const ERROR_FLASH_MS = 2000;   // same SW-reap caveat as flashSaved (see TODOS)

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first: onInstalled re-fires on update and duplicate ids error.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'save-to-plate',
      title: 'Save selection to Plate',
      contexts: ['selection']
    });
  });
  updateBadge();
});

// Rebuild the badge whenever the service worker wakes up.
chrome.runtime.onStartup.addListener(updateBadge);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-to-plate') return;
  const text = (info.selectionText || '').trim();
  if (!text) return;

  const clip = PlateLogic.makeClip({
    text,
    url: (tab && tab.url) || '',
    title: (tab && tab.title) || (tab && tab.url) || 'Untitled',
    now: Date.now()
  });

  try {
    await store.prependClips([clip]);
    flashSaved();
  } catch (e) {
    // No UI surface here; the popup shows the banner on its own failures.
    console.warn('Plate: save failed', e);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: STALE_AMBER });
    setTimeout(updateBadge, ERROR_FLASH_MS);
  }
});

// Keep the badge in sync when the popup archives / deletes / edits. Stats
// changes count too: every popup open writes a stats counter, so the badge
// (incl. the 14-day amber threshold) recomputes at least whenever the user
// touches Plate — the no-permission alternative to chrome.alarms (in TODOS).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[PlateStore.CLIPS_KEY]) updateBadge(changes[PlateStore.CLIPS_KEY].newValue);
  else if (changes[PlateStore.STATS_KEY]) updateBadge();
});

// Accepts the onChanged newValue to skip a redundant full-storage read.
async function updateBadge(clipsFromEvent) {
  let clips = Array.isArray(clipsFromEvent) ? clipsFromEvent : null;
  if (!clips) {
    try {
      clips = await store.readClips();
    } catch (e) {
      console.warn('Plate: badge read failed', e);
      return;
    }
  }
  const now = Date.now();
  const { plate } = PlateLogic.plateCounts(clips, now);
  // Amber when the oldest servable clip has sat > 14 days — the ambient
  // "your plate is going stale" signal (gate decision D21).
  const color = PlateLogic.isPlateStale(clips, now) ? STALE_AMBER : PLATE_GREEN;
  chrome.action.setBadgeText({ text: plate ? String(plate) : '' });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Brief confirmation tick after a save, then fall back to the real count.
// Known debt (TODOS): SW can be reaped mid-timeout, stranding the ✓ briefly.
function flashSaved() {
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: SAVED_GREEN });
  setTimeout(updateBadge, 1100);
}
