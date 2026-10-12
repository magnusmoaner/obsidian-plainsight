# Attachment Text Sync Design

Date: 2026-10-12
Status: Proposed. Not started.

## Problem

Obsidian's search, and anything else that reads the vault as Markdown (Claude sessions, a future search connection for other tools), can't see inside PDFs or scanned images. The vault works around this with **extracted-text notes**: a Markdown note next to each attachment, holding its text.

These notes don't stay up to date. They were written one at a time by Claude sessions, so:

| Attachment event | What happens today |
| --- | --- |
| Renamed or moved inside Obsidian | Fine: Obsidian updates the link in the extracted-text note |
| Contents replaced (new version of a PDF) | Extracted text silently goes stale |
| Deleted | The extracted-text note stays behind, an orphan, still searchable |
| Added | No extracted text until someone runs the tool by hand |
| Changed by iCloud while Obsidian is closed | Same as above, and nothing notices later |

**Goal:** Plainsight keeps the extracted-text notes in sync automatically, on desktop, using the existing macOS tool, and shows their state in the sidebar.

## What exists today (checked 2026-10-12)

- **The tool:** `.tools/extract.swift`, built by `.tools/build.sh` into `.tools/bin/extract`. The binary isn't synced, because it's built per machine. `extract <file>` prints text to stdout:
  - PDFs: each page's text layer, falling back to Vision OCR (da-DK, en-US) when a page has 20 characters of text or fewer. Pages are separated by `===== SIDE n =====`.
  - Images: Vision OCR.
  - `.docx` is handled separately with macOS `textutil` (per the vault's CLAUDE.md).
- **The notes:** 532 of them, all with exactly three properties: `title`, `type: extracted-text` and `tags`.
  - Named `<file>.<ext> (tekst).md`, saved next to the attachment.
  - Body: a `> [!quote] Udtrukket tekst fra [[<file>.<ext>]]` line, then the text.
  - **Nothing records** the source's size, change date or content, so a stale note can't be recognised today.
- **Plainsight already** pairs extracted-text notes with their attachment (via the link), lists them under the file in Attachments, searches their text from there, and keeps them out of note lists (`partition()` in `src/sidebar/view.ts`, `attachmentsFor` in `core/attachments.ts`).

## Decisions

1. **The Markdown note stays the index.** No separate search database. Whatever reads Markdown benefits automatically, and the "Markdown is the source of truth" rule holds.
2. **Same format as today**, so the 532 existing notes don't need rewriting, plus four properties that make staleness detectable:
   ```yaml
   ---
   title: <file> (udtrukket tekst)
   type: extracted-text
   tags: [extracted-text]
   source: "[[<file>.<ext>]]"
   source-size: 482113
   source-mtime: 2026-10-11T14:02:33Z
   source-sha256: 9f2c…
   ---
   ```
   `source` is a link property, so Obsidian keeps it right on renames, as it already does for the body link.
3. **Desktop only for extraction.** Plugins can run a local program on desktop (`child_process.execFile`), never on mobile. On mobile Plainsight only shows the status.
4. **Never lose hand edits.** A note whose body was changed since Plainsight last wrote it is never overwritten. It's flagged as "edited", and re-extracting asks first.
5. **Never auto-delete.** An orphaned extracted-text note (its attachment was deleted) is flagged, not removed. Bulk "Delete orphans" is a deliberate action with a confirmation dialog.
6. **Opt-in, by file type.** Off by default; when turned on, PDFs only. Images and Office files are separate toggles. The vault has ~12,000 attachments, most of them images, and OCR on all of them would run for hours.

## How it works

### Detecting work

- **Live, while Obsidian is open:** vault events `create`, `modify`, `delete` and `rename` for attachments of the enabled types.
  - Debounced about 5s per file, because iCloud often writes a file in several steps.
  - Files that iCloud hasn't downloaded yet are skipped and retried later.
- **At startup (reconcile):** after layout is ready and the sidebar index is built, compare every enabled attachment with its extracted-text note. The cheap check is `size` + `mtime` against `source-size` / `source-mtime`. The SHA-256 is computed only when those differ, to rule out a touch without a content change (e.g. iCloud re-download). This catches everything that changed while Obsidian was closed.

### States

| State | Meaning |
| --- | --- |
| up to date | Source size, mtime (or hash) match |
| stale | The source changed since extraction |
| missing | An enabled attachment has no extracted-text note |
| orphan | The note's `source` (or body link) doesn't resolve |
| edited | The note's body changed since Plainsight wrote it (a hash of the written body is kept in plugin data, not in the note) |
| failed | The tool exited non-zero, timed out, or printed nothing; the reason is kept for the tooltip |
| legacy | One of the 532 existing notes without `source-*` properties: up to date or not is unknown until it is checked once |

### Running the tool

- **A queue, one file at a time,** in the background, with a status bar item ("Extracting 3 of 41…") that pauses or cancels on click.
- **`execFile(binary, [absolutePath])`:** never through a shell, never with the path interpolated into a command line. 120s timeout per file, stdout capped (e.g. 20 MB).
- **The binary path is a setting,** defaulting to `<vault>/.tools/bin/extract`. If it's missing, show "Build it with `.tools/build.sh`" rather than building automatically.
- `.docx`/`.doc`/`.rtf` go through `/usr/bin/textutil -convert txt -stdout`.

### Writing

- **New note:** the format above, created with `vault.create` next to the attachment, named `<file>.<ext> (tekst).md`. If that name is taken by a note that isn't this attachment's extracted text, refuse and flag it rather than pick another name.
- **Updating an existing note:** replace the body below the frontmatter in one `vault.process` call, and change only the `source-*` lines in the frontmatter, recognise-or-refuse as in `core/frontmatter.ts`. Never re-serialize YAML.
- **Legacy notes (first check):** add the four `source-*` lines (a line-based insert before the closing `---`). If the extracted text differs from the note's body, mark the note **stale** and don't overwrite it in the same pass. The first run must never silently replace text someone might have corrected by hand.

### In the sidebar

- **Attachments:** a small status mark on each file card (stale ⟳, missing ∅, failed !, edited ✎). The Attachments filter row gains chips: *Needs text* (missing + stale + failed) and *Orphans*.
- **File menu on an attachment:** *Extract text* / *Re-extract text*, and *Open extracted text*.
- **Orphaned extracted-text notes:** not hidden. Their attachment is gone, so they'd have nowhere else to appear. They show in Notes with an "Attachment deleted" badge, and under the *Orphans* chip.
- **Commands:**
  - Extract text for all attachments that need it
  - Re-check all extracted text
  - Pause or resume extraction

### Settings

| Setting | Default |
| --- | --- |
| Keep extracted text in sync (desktop) | Off |
| Extract from PDFs / images / Office files | On / Off / Off |
| Extractor program | `.tools/bin/extract` |
| Run the startup check | On |

## Code layout

- **`src/sidebar/core/extracted.ts`** (pure, tested):
  - parse and write the `source-*` properties (recognise-or-refuse);
  - build a new note;
  - replace the body;
  - work out the state from (attachment stat, note summary, stored body hash).
- **`src/sidebar/extract-runner.ts`:** the queue, `execFile`, timeouts and the iCloud-placeholder check. Desktop only, loaded behind `Platform.isDesktopApp`.
- **`src/sidebar/extract-sync.ts`:** vault event wiring, the startup reconcile, and the writes through `vault.process` / `vault.create`.
- **`src/sidebar/view.ts`:** status marks, chips and menu items.
- **Plugin data:** the body hash per extracted-text note and the last failure per file. Bookkeeping only, never note content.

## Implementation slices

1. **Core:** `extracted.ts` with tests (properties, body replace, state machine, legacy upgrade). Nothing visible yet.
2. **Status only:** compute states from the index and show them in Attachments (marks, chips, orphan badge). Useful on its own, and on mobile.
3. **Runner:** single-file *Extract text* / *Re-extract text* from the file menu, for testing on a scratch PDF first.
4. **Sync:** live events, the startup reconcile, the queue with its status bar item, and the settings.
5. **Backfill:** the "extract all that need it" command and the legacy upgrade of the 532 notes, run with Magnus watching.
6. **Adversarial review** (this writes to notes), README, and settings table.

## Risks

- **iCloud:** files evicted from the Mac, or written in several steps, can look changed or truncated. Debounce, skip placeholders, and confirm changes by hash before re-extracting.
- **Two Macs:** both could extract the same file at once. The notes are written idempotently (same input, same output), so the worst case is duplicate work. Leave extraction off on the second Mac if it shows up.
- **Long scans:** OCR of a 200-page scan can take minutes. Per-file timeout, one at a time, and the queue survives a restart (it's rebuilt by the startup check).
- **Obsidian review:** running a local program is allowed for desktop plugins but must be disclosed in the README and the submission. It's off by default and runs only the program the user configured.

## Out of scope

- Ranked full-text search inside Plainsight (next, once the text can be trusted).
- An external search connection or MCP server (it reads the same Markdown).
- Extraction on mobile.
- Cloud OCR services (the documents are private).
