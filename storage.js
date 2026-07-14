// Plate — storage helper, the ONLY place clips/stats are written.
// Shared by popup and service worker; factory-injected so node:test can stub
// the storage area and the lock manager.
//
//   popup / SW:  const store = PlateStore.createStore(chrome.storage.local, navigator.locks)
//
// Concurrency: chrome.storage.local has no transactions. Every mutation runs
// inside navigator.locks.request('plate-clips') and re-reads fresh state
// before writing, so a context-menu save landing mid-mutation cannot be
// clobbered. Never persist a stale in-memory array from outside this file.

(function () {
  const CLIPS_KEY = 'clips';
  const STATS_KEY = 'stats';
  const LOCK_NAME = 'plate-clips';

  function createStore(area, locks) {
    const logic = globalThis.PlateLogic;

    function withLock(fn) {
      if (locks && locks.request) return locks.request(LOCK_NAME, fn);
      return fn(); // tests may run lock-less on purpose
    }

    async function readClips() {
      const r = await area.get(CLIPS_KEY);
      const v = r[CLIPS_KEY];
      return Array.isArray(v) ? v : [];
    }

    async function readStats() {
      const r = await area.get(STATS_KEY);
      return logic.normalizeStats(r[STATS_KEY]);
    }

    // mutator: (clips) => clips' (return a new/updated array; return
    // undefined to abort the write). Throws on storage failure so callers
    // can show the "Couldn't save" banner instead of lying optimistically.
    function mutateClips(mutator) {
      return withLock(async () => {
        const clips = await readClips();
        const next = mutator(clips);
        if (next === undefined) return clips;
        await area.set({ [CLIPS_KEY]: next });
        return next;
      });
    }

    // Single-writer by convention: only the popup calls mutateStats.
    function mutateStats(mutator) {
      return withLock(async () => {
        const stats = await readStats();
        const next = mutator(stats);
        if (next === undefined) return stats;
        await area.set({ [STATS_KEY]: next });
        return next;
      });
    }

    // Targeted by-id change; no-ops (and skips the write) on unknown id.
    function mutateClip(id, change) {
      return mutateClips((clips) => {
        const i = clips.findIndex((c) => c.id === id);
        if (i === -1) return undefined;
        const next = clips.slice();
        next[i] = change(next[i]);
        return next;
      });
    }

    function prependClips(newClips) {
      return mutateClips((clips) => [...newClips, ...clips]);
    }

    function removeClip(id) {
      return mutateClips((clips) => {
        const next = clips.filter((c) => c.id !== id);
        return next.length === clips.length ? undefined : next;
      });
    }

    return { CLIPS_KEY, STATS_KEY, readClips, readStats, mutateClips, mutateStats, mutateClip, prependClips, removeClip };
  }

  const api = { createStore, CLIPS_KEY, STATS_KEY };
  globalThis.PlateStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
