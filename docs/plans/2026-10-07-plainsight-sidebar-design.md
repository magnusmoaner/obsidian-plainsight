# Plainsight Sidebar Design

Date: 2026-10-07
Status: Approved (brainstorm with Magnus, 2026-10-07)

## Problem

Obsidian's File explorer is a raw folder tree. It shows filenames and nothing else, so picking the next note means opening notes to find out what's in them. Evernote 11's sidebar solves this with two columns. On the left is a stable, sparse set of places (shortcuts, notes, tasks, templates, notebooks, tags). On the right is a list of note cards with enough context to choose without opening: title, a snippet, task progress, date, tags and a thumbnail.

Plainsight replaces File explorer with that two-column sidebar. The editor work continues separately; this design does not touch it.

## Decisions

- **Layout.** One `ItemView` in the left sidebar holds both columns (nav | note list), with a draggable divider. It moves and collapses as one unit. Magnus disables the core File explorer himself; Plainsight never disables another plugin's view.
- **Packaging.** Same plugin, under `src/sidebar/`, with its own settings toggle so it can be turned off without affecting the editor.
- **Nav items.** Shortcuts, Notes, Tasks, Templates, Notebooks, Tags. Evernote's Spaces are out of scope.
- **Notebooks = nested folders.** Every folder is a notebook, and subfolders show indented (Evernote stacks map onto this). Moving a note to another notebook moves the file with `fileManager.renameFile`, so links update. Folders are the only model another Markdown tool also sees.
- **Shortcuts = Obsidian Bookmarks.** Bookmarks already supports files, folders and saved searches, and stays in sync with the core Bookmarks pane. Its API is internal (`app.internalPlugins…bookmarks`), so it's read defensively: if the shape changes or the plugin is off, the section hides rather than throwing.
- **Pinned = `pinned: true` in frontmatter.** A pinned note floats to the top of any list it appears in, under a "Pinned Notes" header. Shortcuts and pins stay separate concepts, as in Evernote.
- **Tasks = task rows across notes.** One row per task: checkbox, text, source note, and due date read from the Tasks plugin's 📅 field. Filters for open, done and overdue. Clicking a row opens the note at that line. The Tasks plugin's syntax is the only task store; Plainsight never invents fields.
- **Templates = the core Templates folder.** None is configured in the vault yet, so the section shows a one-click "choose folder". Clicking a template creates a new note from it in the current notebook.
- **Tags.** Tags with counts, with nested `a/b` tags indented. Clicking a tag filters the list.

## The note list (right column)

- **Header:** current place name and note count, a New Note button that creates in the current notebook, and a sort menu.
- **Card:** title; a snippet with the Markdown stripped (skipping frontmatter, callout tokens and headings to reach the first useful text); task progress `n/m` when the note has tasks; date; tags; and a thumbnail from the first embedded image.
- **Order:** pinned first, then by modified date, grouped by month ("October 2026"). Sort can also be by created date or by title.
- **Search:** filters the current list by title and content.

## Architecture

**Index, not scan.** On load, build one summary per note: title, tags, frontmatter flags, task items, and first image embed, all from `metadataCache`, plus a snippet from `vault.cachedRead`. Keep the index current from `metadataCache.on("changed")` and `vault.on("rename" | "delete" | "create")`, updating only the affected entry. The vault has 791 notes, so a full build is cheap, but nothing re-reads every file on a keystroke.

**Nav items are queries.** Each place is a function over the index: Notes = everything, a notebook = files under that folder, a tag = notes carrying it, a shortcut = its bookmark target, Tasks = task rows. The list column renders whatever the selected query returns, so six nav items don't become six code paths.

**Virtualised list.** Only visible cards render. That keeps it fast at ten times the current vault size.

**Writes are small and explicit.**

| Action | Mechanism | Touches |
| --- | --- | --- |
| Toggle a task | `vault.process` | one character on one line |
| Pin / unpin | `fileManager.processFrontMatter` | the `pinned` key only |
| Move to notebook | `fileManager.renameFile` | file path; Obsidian updates links |
| New note | `vault.create` in the current folder | a new file |

Nothing else in a note is ever rewritten, so the Tasks plugin's emoji metadata (📅 🔁 ⏫ 🆔) passes through untouched.

**Testability.** The index and the queries are plain TypeScript over a summary type, and get tested in node like the editor core. Only the view layer imports `obsidian`.

## Mobile

Two columns don't fit, so mobile gets a single column with drill-down: places → note list → note.

## Risks

- **Bookmarks API is internal.** It degrades to a hidden section, and won't break.
- **Snippet quality depends on how notes start.** Many notes open with frontmatter, callouts or headings. Test the "first useful text" rule against real notes early, before polishing the card UI.
- **Sidebar width.** Two columns need about 520px. The divider and a persisted width handle this, but it needs checking on a laptop screen.

## Out of scope (for now)

Evernote Spaces, the Reminders tab, sharing, and a task detail dialog. The task dialog needs Tasks-plugin field mapping decided first; see `docs/evernote-11-experience-guide.md` §4.
