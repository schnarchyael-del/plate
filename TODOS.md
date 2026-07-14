# TODOS

Deferred work with context. Each item was explicitly considered and deferred, not forgotten.

## P2 — Product path (blocked on v2 evidence)
- [ ] **Approach C: local-first sync + phone capture app** — Supabase or Cloudflare Worker + KV, single secret token, offline-first background sync, installable phone web app (Android share-target, iOS Shortcut). Why deferred: breaking no-server is a one-way door; waits until v2's Done-per-week thresholds are met and the second user has been observed. Depends on: v2 shipped, 4 weeks of stats. Effort: XL human / L with CC.
- [ ] **Tags v3 (intent-shaped, filter chips, never folders)** — only if #hashtag conventions appear organically in why-notes during the v1/v2 test. Why deferred: zero-code test running now. Depends on: a month of note data.
- [ ] **Pocket/Instapaper export import via the inbox parser** — the parseInbox architecture generalizes to import files; post-Pocket-shutdown acquisition wedge if the product path opens. Why deferred: not in v2 blast radius. Effort: M human / S with CC.

## P3 — Hygiene
- [ ] **Extract DESIGN.md** from the design doc's constraints section (palette tokens, type rules, component vocabulary) so future design reviews calibrate automatically. Effort: S.
- [ ] **Auto AI page summary** — killed for v2 on evidence (unlived pain, breaks offline). Re-evaluate ONLY after the founder personally hits the blank-page moment on a months-old clip. Recorded so it isn't re-litigated from scratch.

## P3 — Accepted debt (from eng review, 2026-07-14)
- [ ] **Per-clip storage keys** — whole-array writes serialize the full clip set per mutation; fine at personal scale, revisit if archive grows past ~2k clips or before Approach C. Also the real fix for residual write amplification.
- [ ] **Badge flash via chrome.alarms** — background.js:70 setTimeout can strand the ✓ badge if the MV3 service worker is reaped mid-flash. Pre-existing v1 wart, cosmetic.

## P2 — Deferred at autoplan final gate (2026-07-14)
- [ ] **Page capture ("Save page to Plate")** — second context-menu item on page context (~15 lines, no new permissions); plugs the open-tab-pile leak, which currently has NO capture path (v1 menu is selection-only). Deferred by founder to hold v2 scope; strongest outside-voice finding of the review — revisit first if tabs are still piling up a month after v2 ships.
- [ ] **JSON export/import of all clips** — uninstall or profile loss wipes chrome.storage.local including the never-deletes archive. One download button + import; also the migration path for Approach C. Deferred by founder; revisit before the archive gets precious.
- [ ] **Copy action on serve card** — feeds send-to-someone intent; blocked on #send hashtag evidence from the note-convention test.
