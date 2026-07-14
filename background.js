// Plate — background service worker
// Handles the right-click "Save selection to Plate" action and keeps the
// toolbar badge showing how many clips are on the active plate.

const STORAGE_KEY = 'clips';
const PLATE_GREEN = '#3D5A40';
const SAVED_GREEN = '#3F9142';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-plate',
    title: 'Save selection to Plate',
    contexts: ['selection']
  });
  updateBadge();
});

// Rebuild the badge whenever the service worker wakes up.
chrome.runtime.onStartup.addListener(updateBadge);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-to-plate') return;
  const text = (info.selectionText || '').trim();
  if (!text) return;

  const clip = {
    id: makeId(),
    text,
    url: (tab && tab.url) || '',
    title: (tab && tab.title) || (tab && tab.url) || 'Untitled',
    why: '',
    archived: false,
    createdAt: Date.now()
  };

  const clips = await getClips();
  clips.unshift(clip);
  await setClips(clips);
  flashSaved();
});

// Keep the badge in sync when the popup archives / deletes / edits.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) updateBadge();
});

function getClips() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (r) => resolve(r[STORAGE_KEY] || []));
  });
}

function setClips(clips) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: clips }, resolve);
  });
}

async function updateBadge() {
  const clips = await getClips();
  const count = clips.filter((c) => !c.archived).length;
  chrome.action.setBadgeText({ text: count ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: PLATE_GREEN });
}

// Brief confirmation tick after a save, then fall back to the real count.
function flashSaved() {
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: SAVED_GREEN });
  setTimeout(updateBadge, 1100);
}

function makeId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
