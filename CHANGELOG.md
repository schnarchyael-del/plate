# Changelog

## v2.1.1.0 — 2026-07-17

### Changed
- The "Inbox" button is now **"Paste"** — it names what you actually do there. (Every tester read "Inbox" as a place messages arrive; it's a door, not a mailbox.)

## v2.1.0.0 — 2026-07-16

### Added
- **Tags**: add a tag to any clip from its card or the serve card — type a new one or pick an existing one (typeahead). Tags render as chips; remove with a tap. A filter bar appears in list view once any tag exists — click a chip to filter, click again to clear. Search matches tags too. Tags are labels, never folders: the plate stays one plate.
- Built because every early tester asked for it. Tags normalize to lowercase, `#` optional when typing.

## v2.0.0.0 — 2026-07-14

The plate serves you. v2 turns Plate from a capture tool into a return ritual.

### Added
- **Serve card**: opening the popup shows one clip — the oldest on your plate — with Done, Open page, and Not today (rests until tomorrow). Collapsed header, serif quote, green reward beat, 3-second undo on Done and Not today, keyboard shortcuts (d / o / n).
- **Phone inbox**: paste your self-texts and each line becomes a clip in one tap. Link recovery attaches sources from trailing URLs, quote-then-link pairs, and Android Chrome highlight links (`#:~:text=`). Duplicates auto-detected and unchecked; your manual checkbox choices survive retyping.
- **Amber staleness badge**: the toolbar badge turns amber when the oldest clip has waited more than 14 days.
- **Local stats**: dones per ISO week, inbox sessions, popup opens — stored locally, shown in the Archive footer, nothing leaves the machine.
- **Age labels**: plate cards show "3 weeks on the plate" instead of raw timestamps.
- Zero-dependency test suite (52 tests, `node --test`, timezone matrix runner).

### Changed
- All storage writes go through a single `navigator.locks`-serialized helper — concurrent saves from the context menu and popup can no longer clobber each other.
- Done and unarchive are explicit idempotent transitions (double-press can't silently un-archive).
- Archiving stamps `archivedAt`; every mutation stamps `updatedAt`. v1 clips work untouched.
- Search highlighting is entity-safe (built with DOM nodes, not string surgery).

### Fixed
- Silent storage failures now show a "Couldn't save" banner.
- Notes commit on idle, so a popup closing mid-edit no longer loses the draft.
- Corrupt storage values can't blank the popup.
- Only http/https URLs are ever assigned to links.

### Security & privacy
- No new permissions. No network. All data stays in `chrome.storage.local`.
