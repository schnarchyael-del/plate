# Chrome Web Store listing kit — Plate 2.0.0

Everything the developer console asks for, ready to paste.
Upload file: `dist/plate-2.1.1.zip`

## Your steps (the parts only you can do)
1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account you want to own Plate.
2. Pay the one-time $5 developer registration fee.
3. "New item" → upload `dist/plate-2.1.1.zip`.
4. Paste the fields below into the listing tabs.
5. Add at least one screenshot, 1280×800 or 640×400 (ask me — I can generate these).
6. Pick visibility (see bottom), submit for review. Simple extensions usually clear in hours to a few days.

## Store listing tab

**Name:** Plate

**Summary (short description, ≤132 chars):**
Save a line, keep the link, jot why. Your plate serves clips back one at a time — clear it, keep the archive. All local.

**Detailed description:**
Plate is a small, calm clipping tool for people who save things and actually want to come back to them.

Highlight a sentence on any page, right-click, Save selection to Plate. Each clip keeps the text, the page link, an optional "why I saved it" note, and when you saved it.

The part that makes Plate different: the plate serves you. Open the popup and you get ONE clip — the oldest on your plate — with three choices: Done, Open page, or Not today (it rests until tomorrow). Done archives the clip: off your plate, never deleted, always searchable. The toolbar badge shows what's on your plate and quietly turns amber when the oldest clip has waited more than two weeks.

Texting yourself links and lines from your phone? Hit Paste, drop the pile in, and each line becomes a clip in one tap. Duplicates are detected automatically, and Plate recovers source links from your pastes — including Android Chrome "share selection" highlight links.

Everything is stored locally in your browser. No account, no server, no tracking, no AI, works offline. Your reading list is nobody's business.

- One-gesture capture from the right-click menu
- Served one clip at a time, with keyboard shortcuts (d / o / n) and undo
- Done archives, never deletes — search everything, forever
- Paste from your phone: automatic link recovery and dedupe
- Local-only stats (dones this week, notes filled) — nothing leaves your machine

**Category:** Productivity → Tools
**Language:** English

## Privacy tab

**Single purpose description:**
Plate lets the user save text selections from web pages into a local reading list, resurfaces them one at a time in the toolbar popup, and archives them when done. All data stays in the user's browser.

**Permission justifications:**
- `storage` — stores the user's saved clips and local usage counters in chrome.storage.local. Nothing is transmitted anywhere.
- `contextMenus` — provides the "Save selection to Plate" right-click item, the extension's only capture mechanism.
- `activeTab` — reads the current tab's title and URL at the moment the user saves a selection, so the clip keeps its source link.

**Data usage disclosures:** check "This item does not collect or use user data" equivalents — Plate collects nothing, transmits nothing, and has no remote code. (Clip content never leaves chrome.storage.local.)

**Privacy policy URL:** not required when no user data is collected. If the form insists, a one-line policy on any page you control: "Plate stores all data locally in your browser and transmits nothing."

## Visibility (Distribution tab)

- **Unlisted** — anyone with the link can install; the store doesn't surface it in search. This is what the plan chose (D19): perfect for you + your test user + friends, zero public commitment. You can flip to Public later without re-review.
- **Public** — searchable by everyone. Fine too, but remember the plan's honest test: Plate's wedge against Chrome's built-in Reading List is the Done ritual. Public means strangers judging that wedge before the second-user experiment has run.

Recommendation: start Unlisted, share the link with your test user, flip to Public when the Done-per-week numbers back you up.

## After it's live
- Install from the store link on your own Chrome too (replace load-unpacked) so you're testing what users get. Your clips survive — they live in the profile, not the package. Actually: NOTE — the store install has a different extension ID, so it gets a FRESH chrome.storage area. Export/import isn't built yet (it's in TODOS). Easiest path: keep using your load-unpacked copy yourself, give the store link to others. Or ask me to build the export/import from TODOS before you switch.
- New versions: bump `manifest.json` version, rebuild the zip (`ask me`), upload in the console. Updates auto-roll to users.
