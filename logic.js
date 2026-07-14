// Plate — pure logic, shared by popup and service worker, tested via node:test.
// No chrome.* APIs in this file. All time-dependent functions take `now`.

(function () {
  const INBOX_RENDER_CAP = 200;
  const STALE_DAYS = 14;
  const DAY_MS = 24 * 60 * 60 * 1000;

  /* ---------- text ---------- */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // NBSP and zero-width characters count as whitespace for trimming/blank checks.
  function cleanLine(line) {
    return line.replace(/[ ​‌‍﻿]/g, ' ').trim();
  }

  /* ---------- inbox parsing ---------- */

  // A line is a URL iff, after trimming, it starts with http:// or https://,
  // contains no whitespace, and parses with the URL constructor. Everything
  // else (bare domains, www. forms, url-plus-text) is a text clip.
  function lineAsUrl(line) {
    if (!/^https?:\/\/\S+$/.test(line)) return null;
    try {
      return new URL(line).href; // normalized
    } catch {
      return null;
    }
  }

  // Chrome "share selection" highlight links carry the quote inside the URL:
  //   https://site.com/a#:~:text=[prefix-,]start[,end][,-suffix]
  // Returns the decoded quote, or null if this isn't (or is a malformed)
  // text-fragment link — callers fall back to a plain link clip.
  function decodeTextFragment(href) {
    try {
      const hash = new URL(href).hash;
      const m = hash.match(/:~:text=([^&]*)/);
      if (!m || !m[1]) return null;
      const core = m[1].split(',').filter((p) => !p.endsWith('-') && !p.startsWith('-'));
      if (!core.length) return null;
      const start = decodeURIComponent(core[0]);
      const end = core[1] ? decodeURIComponent(core[1]) : '';
      const quote = end ? `${start} … ${end}` : start;
      return cleanLine(quote) || null;
    } catch {
      return null;
    }
  }

  // parseInbox(text) -> { candidates, total, capped }
  // Dumb, predictable: strip \r, split on \n, clean, drop blanks. Link
  // recovery (D25): a highlight link becomes quote+source; a trailing URL
  // becomes the line's source; a quote line followed by a URL-only line
  // pairs into one clip.
  function parseInbox(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const all = [];
    for (const raw of lines) {
      const line = cleanLine(raw);
      if (!line) continue;
      const url = lineAsUrl(line);
      if (url) {
        const quote = decodeTextFragment(url);
        if (quote) all.push({ kind: 'text', text: quote, url });
        else all.push({ kind: 'link', text: line, url });
        continue;
      }
      const tm = line.match(/^(.*\S)\s+(https?:\/\/\S+)$/);
      if (tm) {
        const tUrl = normalizeUrl(tm[2]);
        if (tUrl) { all.push({ kind: 'text', text: tm[1], url: tUrl }); continue; }
      }
      all.push({ kind: 'text', text: line, url: '' });
    }
    // Pairing pass: quote line + bare link line -> one clip.
    const merged = [];
    for (let i = 0; i < all.length; i++) {
      const cur = all[i];
      const next = all[i + 1];
      if (cur.kind === 'text' && !cur.url && next && next.kind === 'link') {
        merged.push({ kind: 'text', text: cur.text, url: next.url });
        i++;
        continue;
      }
      merged.push(cur);
    }
    return {
      candidates: merged.slice(0, INBOX_RENDER_CAP),
      total: merged.length,
      capped: merged.length > INBOX_RENDER_CAP
    };
  }

  function normalizeUrl(u) {
    try {
      return new URL(u).href;
    } catch {
      return '';
    }
  }

  // Annotate candidates against existing clips and within-paste duplicates.
  // status: 'ok' | 'already-saved' | 'dup-in-paste'. "already saved" wins.
  // Match rules (exact, case-sensitive): trimmed candidate text equals clip
  // text, or (link candidates only) normalized URLs equal. URL inside a text
  // line does NOT match.
  function dedupeCandidates(candidates, existingClips) {
    const existingTexts = new Set();
    const existingUrls = new Set();
    for (const c of existingClips) {
      if (typeof c.text === 'string') existingTexts.add(c.text.trim());
      if (c.url) {
        const n = normalizeUrl(c.url);
        if (n) existingUrls.add(n);
      }
    }
    const seenTexts = new Set();
    const seenUrls = new Set();
    return candidates.map((cand) => {
      const isSaved =
        existingTexts.has(cand.text) ||
        (cand.kind === 'link' && existingUrls.has(cand.url));
      const isDupInPaste =
        seenTexts.has(cand.text) ||
        (cand.kind === 'link' && seenUrls.has(cand.url));
      seenTexts.add(cand.text);
      if (cand.kind === 'link') seenUrls.add(cand.url);
      const status = isSaved ? 'already-saved' : isDupInPaste ? 'dup-in-paste' : 'ok';
      return { ...cand, status };
    });
  }

  /* ---------- clips ---------- */

  function makeClip({ text, url = '', title = '', now, offset = 0 }) {
    return {
      id: (globalThis.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${now + offset}-${Math.random().toString(16).slice(2)}`,
      text,
      url,
      title: title || (url || 'From phone inbox'),
      why: '',
      archived: false,
      createdAt: now + offset, // batch adds get +i ms so serve order is deterministic
      updatedAt: now + offset
    };
  }

  function isOnPlate(c) {
    return !c.archived;
  }

  function isSnoozed(c, now) {
    return typeof c.snoozedUntil === 'number' && c.snoozedUntil > now;
  }

  // Oldest non-archived, non-snoozed clip; stable tie-break by array order.
  function pickServeClip(clips, now) {
    let best = null;
    for (const c of clips) {
      if (!isOnPlate(c) || isSnoozed(c, now)) continue;
      if (!best || (c.createdAt || 0) < (best.createdAt || 0)) best = c;
    }
    return best;
  }

  function plateCounts(clips, now) {
    let plate = 0;
    let snoozed = 0;
    for (const c of clips) {
      if (!isOnPlate(c)) continue;
      plate++;
      if (isSnoozed(c, now)) snoozed++;
    }
    return { plate, snoozed, servable: plate - snoozed };
  }

  // Start of the next local day. Date constructor rolls over month/year and
  // shifts nonexistent midnights (DST-skipped) forward, which is what we want.
  function startOfNextLocalDay(now) {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  // Archive-toggle transition. Stamps archivedAt and reports whether this
  // counts as a Done (false -> true only). Unarchive clears archivedAt and
  // any snooze; it never counts as a Done.
  function applyToggleArchive(clip, now) {
    if (!clip.archived) {
      return {
        clip: { ...clip, archived: true, archivedAt: now, snoozedUntil: undefined, updatedAt: now },
        didArchive: true
      };
    }
    return {
      clip: { ...clip, archived: false, archivedAt: undefined, updatedAt: now },
      didArchive: false
    };
  }

  function applySnooze(clip, now) {
    return { ...clip, snoozedUntil: startOfNextLocalDay(now), updatedAt: now };
  }

  // Badge staleness: oldest non-snoozed plate clip older than STALE_DAYS.
  function isPlateStale(clips, now) {
    const oldest = pickServeClip(clips, now);
    return !!oldest && now - (oldest.createdAt || now) > STALE_DAYS * DAY_MS;
  }

  /* ---------- stats ---------- */

  // ISO week key with ISO week-YEAR (Jan 1 can belong to week 52/53 of the
  // previous ISO year). Format: "2026-W29".
  function isoWeekKey(now) {
    const d = new Date(now);
    // Work in UTC to avoid TZ drift inside the algorithm; input day comes
    // from local calendar date.
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = t.getUTCDay() || 7; // Mon=1..Sun=7
    t.setUTCDate(t.getUTCDate() + 4 - dayNum); // nearest Thursday
    const weekYear = t.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil(((t - yearStart) / DAY_MS + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, '0')}`;
  }

  function defaultStats() {
    return { donesByWeek: {}, inboxSessions: 0, inboxClipsAdded: 0, popupOpens: 0 };
  }

  // Shape guard: corrupt or missing values reset to defaults, NaN counters to 0.
  function normalizeStats(raw) {
    const s = defaultStats();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
    if (raw.donesByWeek && typeof raw.donesByWeek === 'object' && !Array.isArray(raw.donesByWeek)) {
      for (const [k, v] of Object.entries(raw.donesByWeek)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) s.donesByWeek[k] = n;
      }
    }
    for (const key of ['inboxSessions', 'inboxClipsAdded', 'popupOpens']) {
      const n = Number(raw[key]);
      s[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return s;
  }

  function recordDone(stats, now) {
    const s = normalizeStats(stats);
    const key = isoWeekKey(now);
    s.donesByWeek[key] = (s.donesByWeek[key] || 0) + 1;
    return s;
  }

  function recordUndoDone(stats, now) {
    const s = normalizeStats(stats);
    const key = isoWeekKey(now);
    if (s.donesByWeek[key] > 0) s.donesByWeek[key] -= 1;
    return s;
  }

  function noteFillRate(clips) {
    let withNote = 0;
    for (const c of clips) if ((c.why || '').length > 0) withNote++;
    return { withNote, total: clips.length };
  }

  /* ---------- display ---------- */

  function relTime(ts, now) {
    if (!ts) return '';
    const s = Math.floor((now - ts) / 1000);
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

  // "3 weeks on the plate" — for the serve card and plate list.
  function ageLabel(createdAt, now) {
    if (!createdAt) return '';
    const days = Math.floor((now - createdAt) / DAY_MS);
    if (days < 1) return 'served fresh today';
    if (days === 1) return '1 day on the plate';
    if (days < 14) return `${days} days on the plate`;
    const weeks = Math.floor(days / 7);
    return `${weeks} weeks on the plate`;
  }

  // Only http(s) URLs may be assigned to href (import-proofing).
  function safeHref(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch { /* fall through */ }
    return '';
  }

  const api = {
    INBOX_RENDER_CAP, STALE_DAYS,
    escapeHtml, cleanLine, parseInbox, normalizeUrl, dedupeCandidates,
    makeClip, isSnoozed, pickServeClip, plateCounts, startOfNextLocalDay,
    applyToggleArchive, applySnooze, isPlateStale,
    isoWeekKey, defaultStats, normalizeStats, recordDone, recordUndoDone,
    noteFillRate, relTime, ageLabel, safeHref
  };

  globalThis.PlateLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
