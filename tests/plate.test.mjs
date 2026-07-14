// Plate v2 logic + storage tests. Zero dependencies: node --test tests/
// TZ-sensitive suites also pass under explicit zones, e.g.:
//   TZ=America/Santiago node --test tests/   (DST-skipped midnight)
//   TZ=Pacific/Kiritimati node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../logic.js');
const S = require('../storage.js');

const T0 = new Date(2026, 6, 14, 10, 0, 0).getTime(); // Tue 2026-07-14 10:00 local
const DAY = 24 * 60 * 60 * 1000;

function clip(over = {}) {
  return { id: over.id || Math.random().toString(16).slice(2), text: 'quote', url: 'https://example.com/a', title: 'A page', why: '', archived: false, createdAt: T0, ...over };
}

/* ---------------- parseInbox ---------------- */
describe('parseInbox', () => {
  test('url-only line becomes a link clip candidate', () => {
    const r = L.parseInbox('https://example.com/article');
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].kind, 'link');
    assert.equal(r.candidates[0].url, 'https://example.com/article');
  });
  test('bare domain and www. lines are text', () => {
    const r = L.parseInbox('example.com/article\nwww.example.com');
    assert.deepEqual(r.candidates.map((c) => c.kind), ['text', 'text']);
  });
  test('url + text line is a text clip; a TRAILING url is extracted as source (D25), a mid-line url stays in the text', () => {
    const trailing = L.parseInbox('read this https://example.com/x').candidates[0];
    assert.equal(trailing.kind, 'text');
    assert.equal(trailing.text, 'read this');
    assert.equal(trailing.url, 'https://example.com/x');
    const mid = L.parseInbox('see https://example.com/x for details').candidates[0];
    assert.equal(mid.kind, 'text');
    assert.match(mid.text, /https:\/\/example\.com\/x/);
    assert.equal(mid.url, '');
  });
  test('blank lines, whitespace-only, CRLF, NBSP and zero-width are handled', () => {
    const r = L.parseInbox('one\r\n\r\n   \n ​\ntwo\r\n');
    assert.deepEqual(r.candidates.map((c) => c.text), ['one', 'two']);
  });
  test('whitespace-only paste yields nothing', () => {
    assert.equal(L.parseInbox('  \n\r\n   ').total, 0);
  });
  test('trailing punctuation stays part of the URL (dumb rule, predictable)', () => {
    const r = L.parseInbox('https://example.com/a.');
    assert.equal(r.candidates[0].kind, 'link');
    assert.equal(r.candidates[0].url, 'https://example.com/a.');
  });
  test('caps at 200 candidates and reports the real total', () => {
    const blob = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
    const r = L.parseInbox(blob);
    assert.equal(r.candidates.length, 200);
    assert.equal(r.total, 250);
    assert.equal(r.capped, true);
  });
  test('100KB single line does not choke', () => {
    const r = L.parseInbox('x'.repeat(100_000));
    assert.equal(r.total, 1);
  });
  test('WhatsApp-shaped blob: timestamp prefix lines become text candidates; trailing-URL rule recovers the link (PLACEHOLDER FIXTURE — replace with a real blob from the confirmed Android channel before ship)', () => {
    const blob = '[10:23, 14/07/2026] Yael: https://example.com/save-me\n[10:24, 14/07/2026] Yael: remember this line';
    const r = L.parseInbox(blob);
    assert.deepEqual(r.candidates.map((c) => c.kind), ['text', 'text']);
    // trailing-URL extraction strips the URL off the prefixed line and keeps it as source
    assert.equal(r.candidates[0].url, 'https://example.com/save-me');
    assert.equal(r.candidates[0].text, '[10:23, 14/07/2026] Yael:');
  });

  describe('link recovery (D25)', () => {
    test('trailing URL splits into quote + source', () => {
      const [c] = L.parseInbox('the best products start small https://blog.example.com/article').candidates;
      assert.equal(c.kind, 'text');
      assert.equal(c.text, 'the best products start small');
      assert.equal(c.url, 'https://blog.example.com/article');
    });
    test('quote line followed by URL-only line pairs into one clip', () => {
      const r = L.parseInbox('a line worth keeping\nhttps://example.com/source');
      assert.equal(r.candidates.length, 1);
      assert.equal(r.candidates[0].text, 'a line worth keeping');
      assert.equal(r.candidates[0].url, 'https://example.com/source');
    });
    test('pairing is one-shot and ordered: link-then-quote does NOT pair; two links do NOT pair', () => {
      const r1 = L.parseInbox('https://example.com/a\nsome text after');
      assert.equal(r1.candidates.length, 2);
      const r2 = L.parseInbox('https://example.com/a\nhttps://example.com/b');
      assert.deepEqual(r2.candidates.map((c) => c.kind), ['link', 'link']);
    });
    test('a quote that already has a trailing URL does not also swallow the next link line', () => {
      const r = L.parseInbox('quote https://example.com/a\nhttps://example.com/b');
      assert.equal(r.candidates.length, 2);
      assert.equal(r.candidates[0].url, 'https://example.com/a');
      assert.equal(r.candidates[1].kind, 'link');
    });
    test('Chrome highlight link decodes into quote + source', () => {
      const [c] = L.parseInbox('https://example.com/a#:~:text=hello%20world').candidates;
      assert.equal(c.kind, 'text');
      assert.equal(c.text, 'hello world');
      assert.equal(c.url, 'https://example.com/a#:~:text=hello%20world');
    });
    test('highlight link with prefix/suffix and start,end decodes to "start … end"', () => {
      const [c] = L.parseInbox('https://example.com/a#:~:text=pre-,start%20text,end%20text,-suf').candidates;
      assert.equal(c.text, 'start text … end text');
    });
    test('malformed highlight fragment falls back to a plain link clip', () => {
      const [c] = L.parseInbox('https://example.com/a#:~:text=%E0%A4%A').candidates;
      assert.equal(c.kind, 'link');
    });
    test('cap and total are computed after pairing', () => {
      const blob = Array.from({ length: 30 }, (_, i) => `quote ${i}\nhttps://example.com/${i}`).join('\n');
      const r = L.parseInbox(blob);
      assert.equal(r.total, 30);
      assert.equal(r.candidates.every((c) => c.url), true);
    });
  });
});

/* ---------------- dedupe ---------------- */
describe('dedupeCandidates', () => {
  const existing = [clip({ text: 'known text', url: 'https://known.com/page' })];
  test('exact text match marks already-saved', () => {
    const [c] = L.dedupeCandidates([{ kind: 'text', text: 'known text', url: '' }], existing);
    assert.equal(c.status, 'already-saved');
  });
  test('text match is case-sensitive', () => {
    const [c] = L.dedupeCandidates([{ kind: 'text', text: 'Known Text', url: '' }], existing);
    assert.equal(c.status, 'ok');
  });
  test('link candidate matches stored url with normalization (trailing slash)', () => {
    const cand = L.parseInbox('https://known.com/page').candidates;
    const [c] = L.dedupeCandidates(cand, [clip({ url: 'https://known.com/page/' })]);
    // URL normalization: /page and /page/ are different paths — must NOT match.
    assert.equal(c.status, 'ok');
    const [c2] = L.dedupeCandidates(cand, [clip({ url: 'https://known.com/page' })]);
    assert.equal(c2.status, 'already-saved');
  });
  test('url inside a text line does not match a link clip', () => {
    const [c] = L.dedupeCandidates([{ kind: 'text', text: 'see https://known.com/page', url: '' }], existing);
    assert.equal(c.status, 'ok');
  });
  test('within-paste duplicates collapse to first; already-saved wins over dup-in-paste', () => {
    const cands = L.parseInbox('fresh line\nfresh line\nknown text\nknown text').candidates;
    const r = L.dedupeCandidates(cands, existing);
    assert.deepEqual(r.map((c) => c.status), ['ok', 'dup-in-paste', 'already-saved', 'already-saved']);
  });
});

/* ---------------- serve / snooze ---------------- */
describe('pickServeClip + snooze', () => {
  test('oldest non-snoozed, non-archived wins', () => {
    const clips = [clip({ id: 'new', createdAt: T0 }), clip({ id: 'old', createdAt: T0 - 5 * DAY }), clip({ id: 'archived', createdAt: T0 - 9 * DAY, archived: true })];
    assert.equal(L.pickServeClip(clips, T0).id, 'old');
  });
  test('snoozed clips are skipped until the next local day', () => {
    const snoozed = { ...clip({ id: 'a', createdAt: T0 - 3 * DAY }), snoozedUntil: L.startOfNextLocalDay(T0) };
    const clips = [snoozed, clip({ id: 'b', createdAt: T0 - DAY })];
    assert.equal(L.pickServeClip(clips, T0).id, 'b');
    const tomorrow = L.startOfNextLocalDay(T0) + 60_000;
    assert.equal(L.pickServeClip(clips, tomorrow).id, 'a');
  });
  test('all snoozed -> null (drives the plate-rests state)', () => {
    const c = { ...clip({}), snoozedUntil: L.startOfNextLocalDay(T0) };
    assert.equal(L.pickServeClip([c], T0), null);
    assert.equal(L.plateCounts([c], T0).servable, 0);
  });
  test('v1-shaped clips (no snoozedUntil/archivedAt/updatedAt) serve fine', () => {
    const v1 = { id: 'v1', text: 't', url: '', title: 'x', why: '', archived: false, createdAt: T0 - DAY };
    assert.equal(L.pickServeClip([v1], T0).id, 'v1');
  });
  test('batch tie-break: createdAt + i offsets keep serve order deterministic', () => {
    const batch = ['a', 'b', 'c'].map((t, i) => L.makeClip({ text: t, now: T0, offset: i }));
    assert.equal(L.pickServeClip(batch, T0 + 1000).text, 'a');
  });
  test('snooze boundary: 23:59 stays snoozed, 00:00 next day wakes', () => {
    const lateNight = new Date(2026, 6, 14, 23, 59, 0).getTime();
    const snoozedAt = new Date(2026, 6, 14, 9, 0, 0).getTime();
    const c = L.applySnooze(clip({}), snoozedAt);
    assert.equal(L.isSnoozed(c, lateNight), true);
    assert.equal(L.isSnoozed(c, c.snoozedUntil), false);
  });
  test('startOfNextLocalDay always lands strictly after now, even across DST', () => {
    for (let d = 0; d < 400; d++) {
      const now = T0 + d * DAY + 7 * 60 * 60 * 1000;
      assert.ok(L.startOfNextLocalDay(now) > now);
    }
  });
});

/* ---------------- archive transition ---------------- */
describe('applyToggleArchive', () => {
  test('false->true stamps archivedAt, clears snooze, counts as Done', () => {
    const snoozed = { ...clip({}), snoozedUntil: L.startOfNextLocalDay(T0) };
    const { clip: c, didArchive } = L.applyToggleArchive(snoozed, T0);
    assert.equal(didArchive, true);
    assert.equal(c.archived, true);
    assert.equal(c.archivedAt, T0);
    assert.equal(c.snoozedUntil, undefined);
  });
  test('true->false clears archivedAt and does NOT count as Done', () => {
    const archived = { ...clip({}), archived: true, archivedAt: T0 - DAY };
    const { clip: c, didArchive } = L.applyToggleArchive(archived, T0);
    assert.equal(didArchive, false);
    assert.equal(c.archived, false);
    assert.equal(c.archivedAt, undefined);
  });
});

/* ---------------- stats ---------------- */
describe('stats', () => {
  test('isoWeekKey uses ISO week-YEAR across the boundary', () => {
    assert.equal(L.isoWeekKey(new Date(2027, 0, 1).getTime()), '2026-W53'); // Fri Jan 1 2027 -> ISO 2026-W53
    assert.equal(L.isoWeekKey(new Date(2026, 0, 1).getTime()), '2026-W01'); // Thu Jan 1 2026
    assert.equal(L.isoWeekKey(new Date(2028, 0, 2).getTime()), '2027-W52'); // Sun Jan 2 2028 -> ISO 2027-W52
    assert.equal(L.isoWeekKey(T0), '2026-W29');
  });
  test('recordDone/recordUndoDone round-trip within a week', () => {
    let s = L.recordDone(L.defaultStats(), T0);
    s = L.recordDone(s, T0 + 1000);
    assert.equal(s.donesByWeek['2026-W29'], 2);
    s = L.recordUndoDone(s, T0);
    assert.equal(s.donesByWeek['2026-W29'], 1);
  });
  test('normalizeStats resets corrupt shapes and NaN counters', () => {
    assert.deepEqual(L.normalizeStats(['not', 'an', 'object']), L.defaultStats());
    const s = L.normalizeStats({ donesByWeek: { '2026-W29': 'NaN-ish' }, popupOpens: 'x', inboxSessions: -3, inboxClipsAdded: 7 });
    assert.deepEqual(s.donesByWeek, {});
    assert.equal(s.popupOpens, 0);
    assert.equal(s.inboxSessions, 0);
    assert.equal(s.inboxClipsAdded, 7);
  });
  test('noteFillRate scans current state (post-save notes count)', () => {
    const r = L.noteFillRate([clip({ why: 'x' }), clip({}), clip({ why: 'y' })]);
    assert.deepEqual(r, { withNote: 2, total: 3 });
  });
});

/* ---------------- staleness + display ---------------- */
describe('staleness + display helpers', () => {
  test('isPlateStale flips past 14 days on the oldest servable clip', () => {
    const fresh = [clip({ createdAt: T0 - 13 * DAY })];
    const stale = [clip({ createdAt: T0 - 15 * DAY })];
    assert.equal(L.isPlateStale(fresh, T0), false);
    assert.equal(L.isPlateStale(stale, T0), true);
    assert.equal(L.isPlateStale([], T0), false);
  });
  test('ageLabel wording', () => {
    assert.equal(L.ageLabel(T0 - 3 * DAY, T0), '3 days on the plate');
    assert.equal(L.ageLabel(T0 - 21 * DAY, T0), '3 weeks on the plate');
    assert.equal(L.ageLabel(T0, T0), 'served fresh today');
  });
  test('safeHref allows only http/https', () => {
    assert.equal(L.safeHref('https://x.com/a'), 'https://x.com/a');
    assert.equal(L.safeHref('javascript:alert(1)'), '');
    assert.equal(L.safeHref('chrome://settings'), '');
    assert.equal(L.safeHref('not a url'), '');
  });
  test('escapeHtml covers element-content injection', () => {
    assert.equal(L.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  });
});

/* ---------------- storage: stubbed area + locks ---------------- */
function fakeArea() {
  const data = {};
  return {
    data,
    async get(key) {
      await Promise.resolve(); // async gap like the real API
      return { [key]: structuredClone(data[key]) };
    },
    async set(obj) {
      await Promise.resolve();
      await Promise.resolve(); // widen the get->set window to expose races
      Object.assign(data, structuredClone(obj));
    }
  };
}

function fakeLocks() {
  let chain = Promise.resolve();
  return {
    request(_name, fn) {
      const run = chain.then(() => fn());
      chain = run.catch(() => {});
      return run;
    }
  };
}

describe('storage helper', () => {
  test('interleaving: concurrent mutations both survive under locks', async () => {
    const area = fakeArea();
    const store = S.createStore(area, fakeLocks());
    await store.mutateClips(() => [clip({ id: 'seed' })]);
    await Promise.all([
      store.prependClips([clip({ id: 'from-popup' })]),
      store.prependClips([clip({ id: 'from-background' })])
    ]);
    const clips = await store.readClips();
    assert.deepEqual(new Set(clips.map((c) => c.id)), new Set(['seed', 'from-popup', 'from-background']));
  });
  test('control: the same interleaving WITHOUT locks can drop a write (documents why locks exist)', async () => {
    const area = fakeArea();
    const store = S.createStore(area, null);
    await store.mutateClips(() => [clip({ id: 'seed' })]);
    await Promise.all([
      store.prependClips([clip({ id: 'a' })]),
      store.prependClips([clip({ id: 'b' })])
    ]);
    const clips = await store.readClips();
    assert.ok(clips.length <= 3, 'lock-less interleave demonstrates the hazard');
  });
  test('mutateClip on unknown id skips the write', async () => {
    const area = fakeArea();
    const store = S.createStore(area, fakeLocks());
    await store.mutateClips(() => [clip({ id: 'x', why: '' })]);
    const before = structuredClone(area.data);
    await store.mutateClip('nope', (c) => ({ ...c, why: 'changed' }));
    assert.deepEqual(area.data, before);
  });
  test('corrupt clips value (non-array) reads as empty', async () => {
    const area = fakeArea();
    area.data.clips = { evil: true };
    const store = S.createStore(area, fakeLocks());
    assert.deepEqual(await store.readClips(), []);
  });
  test('storage failure propagates so the UI can show the banner', async () => {
    const area = fakeArea();
    area.set = async () => { throw new Error('QUOTA_BYTES exceeded'); };
    const store = S.createStore(area, fakeLocks());
    await assert.rejects(() => store.mutateClips(() => [clip({})]), /QUOTA/);
  });
});
