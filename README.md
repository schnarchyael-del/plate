# Plate

Save a sentence or paragraph, keep the link, jot why you saved it. The plate serves you one clip at a time; clear it, keep the archive.

## What it does
- Highlight text on any page → right-click → **Save selection to Plate**
- Each clip stores: the selected text, the page title + link, an optional "why I saved it" note, and when you saved it
- **The plate serves you** (v2): opening the popup shows ONE clip — the oldest on your plate — with **Done**, **Open page**, and **Not today** (rests it until tomorrow). Keyboard: `d` / `o` / `n`. Both Done and Not today give you 3 seconds to undo. "show the full plate" gets you the list.
- **Paste from your phone** (v2): keep texting yourself links and lines from your phone. Back at the desk, hit **Paste** in the list view, paste the blob, and each line becomes a clip in one tap. Duplicates are detected and unchecked automatically. Plate recovers source links from your pastes: a URL at the end of a line becomes that clip's source, a quote followed by a link on the next line pairs into one clip, and Android Chrome "share selection" highlight links unpack into quote + source. **Phone tip:** share the selection instead of copying it — the link comes along for free.
- **Plate** = your active working set. The toolbar badge shows how many are on it — and turns **amber** when the oldest clip has sat more than two weeks.
- **Done** moves a clip to the **Archive** — off the plate, still fully searchable, never deleted
- Search matches across the text, note, title, and URL, in whichever view you're in (use **All** to search everything)
- **Local stats** (footer of Archive/All views): dones this week, note fill rate, inbox sessions. Nothing ever leaves your machine.

## Install (load unpacked)
1. Unzip this folder somewhere you'll keep it (don't delete it later — Chrome loads it from disk)
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select this `plate` folder
5. Pin the Plate icon from the puzzle-piece menu so the badge count is visible

## Notes
- Everything is stored locally in your browser (`chrome.storage.local`). No account, no server, no API. Works offline.
- To edit a note, click the note line on any card. Cmd/Ctrl+Enter or clicking away saves; Esc cancels.
- Also works in any Chromium browser (Edge, Brave, Arc) via the same load-unpacked steps.
- **Tags** (v2.1): hit `+ tag` on any card to label it — new tag or pick an existing one. Chips under the search bar filter by tag; search matches tags too. Tags are labels, not folders: your plate stays one plate.

## Data (v2 schema)
- `clips`: array of `{ id, text, url, title, why, archived, createdAt, updatedAt, archivedAt?, snoozedUntil? }`. v1 clips (without the newer fields) keep working untouched.
- `stats`: `{ donesByWeek: { "2026-W29": n }, inboxSessions, popupOpens, inboxClipsAdded }` — local only, single writer (the popup).
- All writes go through `storage.js` (`navigator.locks`-serialized); pure rules live in `logic.js`.

## Development
- No build step. Load unpacked, edit, reload.
- Tests (zero dependencies): `node --test tests/plate.test.mjs` — also run with `TZ=America/Santiago` and `TZ=UTC` for the timezone cases.
