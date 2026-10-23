# Plainsight

An Obsidian plugin for a calm, document-like note experience: Markdown that reads like a page instead of syntax, and a two-column notes sidebar that shows what's in a note before you open it.

Your files stay ordinary Markdown. Plainsight hides syntax and adds browsing on top; it never converts your notes into another format.

> **Status:** early and in active development. Not yet in the Community Plugins directory, and only tested on desktop (macOS). The editor is in beta and a work in progress; the notes sidebar is in daily use. Hotkeys for Apple Intelligence's Writing Tools come in a companion plugin, [Plainsight Menu Commands](https://github.com/magnusmoaner/obsidian-plainsight-menu-commands).

## The editor (beta, work in progress)

> **Beta, work in progress.** The editor draws only part of Markdown so far, more is being added (see below), and you may meet rough edges. It changes how notes look and how keys behave, never what's in your files, so switching it off (**Enable WYSIWYG editing** in settings, or the *Toggle WYSIWYG editing* command) gives you plain Obsidian back at once. The sidebar works the same either way.

Formatting renders as you type, and the syntax never comes back: there's no "reveal the markup when the cursor gets close". Typing Markdown still works, because a construct converts the moment it's complete.

- **Bold, italic, inline code, highlights and strikethrough.** Delimiters (`**`, `*`, `` ` ``, `==`, `~~`) stay hidden, and the caret moves past them like rich text. Backspace at the edge of a formatted span removes the formatting instead of exposing a `**`.
- **Escaped characters.** `\[` shows as `[`: the backslash stays hidden, and Backspace or Delete removes the character together with it. (In tables, which show as Markdown, the backslash stays visible.)
- **Headings.** `# ` disappears once you type the space, and each level is styled. Backspace at the start of a heading turns it back into a paragraph.
- **Callouts.** `> [!type]` blocks render as boxes while you edit them. A `···` button changes the callout type.
- **Links.** Only the link text shows: `[text](url)` shows *text*, `[[Note|alias]]` shows *alias*, `[[Note#Section]]` shows *Note › Section*, and bare URLs show shortened (`github.com/…/repo`). Text you wrote (link text, aliases) stays editable in place; text derived from the target moves as one unit. A plain click places the cursor; **Cmd/Ctrl+click opens** the link (add Opt/Alt to open it to the right). Links to notes that don't exist get a dashed underline, and imported `evernote:///` links are muted.

Anything Plainsight doesn't render yet (lists, tables, embeds and more) stays visible as plain Markdown and fully editable.

### Live Preview vs Source mode

Obsidian's Live Preview draws some blocks, such as callouts, itself, and turns them back into Markdown when you click in. To make Plainsight the only renderer, turn on **Let Plainsight draw everything (Source mode)**. Your previous editor mode is restored when you turn it off. The trade-off is that in Source mode anything Plainsight doesn't render yet shows as Markdown.

The editor's keyboard shortcuts are listed under [Commands and hotkeys](#commands-and-hotkeys).

## The notes sidebar

Evernote-style browsing for your vault. The sidebar is its own tab in Obsidian's left sidebar, with two columns: **places** on the left, and what's in the selected place on the right, as cards that show what a note holds before you open it. Obsidian's File explorer keeps working next to it, so use either, or both.

### Places

| Place | What you get |
| --- | --- |
| **Bookmarks** | Obsidian's own bookmarks, with their bookmark group on the right. Bookmarks to deleted notes are crossed out; click one to remove it. |
| **Notes** | Every note, pinned notes first. Group by month, folder or type, or not at all. Chips filter to Notes, Boards ([Kanban](https://github.com/mgmeyers/obsidian-kanban) and [Task List Kanban](https://github.com/erikars/task-list-kanban)) or Canvases. |
| **Tasks** | Tasks from all your notes. See below. |
| **Attachments** | PDFs, images and other files, with thumbnails, searchable by the text inside them. See below. |
| **Templates** | The core Templates folder. Click a template to create a note from it. |
| **Folders** and **Tags** | Collapsible trees with counts. Folders Obsidian uses for attachments are left out. |

**Tasks.** Filter by Open, Overdue or Done, or by a single note. Each task shows its note, plus badges for priority, due and scheduled dates ("Tomorrow"; overdue in red), recurrence and tags. Group by due date, scheduled date (done tasks by the day they were done), priority, recurrence, tag, folder, note or Kanban board ("Board › List", in the board's order). The task under your cursor in a note is highlighted in the list. Ticking a task goes through the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin when it's installed, so done dates and recurring tasks behave exactly as inside a note.

**Attachments.** A file's extracted text is its card's preview and makes it findable by what it says. The text comes from [OCR Extractor](https://github.com/jritzi/ocr-extractor)'s *Extracted text* boxes under the file's embeds, or from extracted-text notes (frontmatter `type: extracted-text` with a link to the file), which are listed with the file and kept out of your note lists. Right-click a file for:
- **Open extracted text**, which jumps to the box or note holding its text;
- **Open containing note**, which opens each note that embeds or links the file, at that spot (greyed out when no note does).

### Note cards

Each card shows the title, the first useful line of text, task progress (`3/6`), the date, tags and a thumbnail. Canvases and boards get their own icons; a Kanban board shows how many cards it holds (archived ones aren't counted), and a Task List Kanban board is labelled as one, since its cards are tasks from your other notes.

Right-click a card to open it in a new tab or to the right, pin or unpin it, rename or delete it, plus whatever other plugins add (such as *Move file to…*). Right-click a folder for New note, New folder, Rename and Delete.

### Previews

Rest the mouse on a card to preview the note or file beside the list; rest it on a task to preview its note, scrolled to the task. This is Obsidian's core Page preview:
- To preview only while Cmd/Ctrl is held, turn on **Plainsight** in Page preview's settings.
- To turn previews off, switch off **Preview on hover** in Plainsight's settings.
- Files with `#` in their name get no preview, since Page preview reads `#` as the start of a heading.

### Creating things

- **The button row** at the top of the left column: the **Note** pill, then round buttons for **Search**, **New folder**, **New task** and **⋯**. Settings can hide the whole row, or any of the round buttons; a hidden Search, New folder or New task button (and, on a narrow column, New folder and New task) moves into the **⋯** menu.
- **A `+`** appears when you hover Notes, Tasks, Folders or Tags (not on touch screens).
- **The list header** has a button for a new note (a new task on the Tasks page), and one for a new [Kanban](https://github.com/mgmeyers/obsidian-kanban) or [Task List Kanban](https://github.com/erikars/task-list-kanban) board in the folder you're viewing (with both plugins enabled, it asks which).
- **The ⋯ menu** creates tags, canvases and boards, inserts a template into the open note, opens Obsidian's search, quick switcher, graph view and the Importer, and has expand/collapse all, bookmark cleanup and settings.

Buttons and menu items for plugins that aren't enabled are hidden.

**New tasks** open a quick-add dialog. Type the task, then optionally pick a due date (Today, Tomorrow, Next week or any date), a priority, a repeat (daily, weekdays, weekly, monthly or yearly, optionally counted from when it's done) and which note it goes into. **More details** adds scheduled and start dates. The task is written in the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin's format, including its global filter and created date if you use them, at the end of a note you choose once (changeable in settings, or per task).

**New tags** are added to the note you have open.

### Search

- **Search everywhere** (the round **Search** button, or the command, which is worth a hotkey) looks through tasks, notes, attachments (by name and by their text), folders and tags at once. The best matches come first, with excerpts, grouped by kind. Choosing a result shows it in the sidebar too. **Show in Obsidian search** hands the query to Obsidian's own search. With [Omnisearch](https://github.com/scambier/obsidian-omnisearch) installed, its typo-tolerant ranking orders the notes and attachments. With Tasks installed, **Insert as Tasks query** puts the search into your note as a ` ```tasks ` block.
- **The search field above the list** narrows the list you're looking at, keeping its order and grouping.

Both understand the same queries:

| Query | Finds |
| --- | --- |
| `bank fee` | both words, anywhere |
| `"monthly fee"` | the exact phrase |
| `-loan`, `-"old account"` | leaves these out |
| `#work`, `tag:work`, `-#home` | a tag, including tags nested under it (`work/client`) |
| `path:Inbox`, `in:Inbox` | anywhere in the note's path |
| `file:plan` | in the note's name |
| `is:open`, `is:done`, `is:overdue`, `is:recurring` | tasks by state |
| `is:note`, `is:board`, `is:canvas`, `is:pinned` | notes by kind |
| `due:today`, `due:tomorrow`, `due:week`, `due:overdue`, `due:none`, `due:2026-11-01`, `due:<2026-11-01`, `due:>2026-11-01` | tasks by due date |
| `scheduled:…` | tasks by scheduled date (the same values) |
| `priority:high` (`highest`, `high`, `medium`, `normal`, `low`, `lowest`) | tasks by priority |

In a list of notes, a task query keeps the notes that have a matching task.

### Good to know

- **Fast start.** The sidebar opens at once and reads your most recently changed notes first, so they show almost straight away. A thin bar under the list header runs until the rest are read.
- **Out of the way while you type.** Changes to the note you're typing in reach the sidebar when you pause, and only the cards, tasks and counts that changed are redrawn, so the sidebar never slows typing down.
- **Per device.** Folded sections, column width, grouping and the filter chips are remembered on each device and don't sync, so your phone and computer can each keep their own (Obsidian 1.8.7 or later).

## Commands and hotkeys

Every Plainsight command is in the command palette (`Cmd/Ctrl + P`), named *Plainsight: …*.

**Shortcuts that work out of the box**, while you're editing a note:

| Keys | Action |
| --- | --- |
| `Cmd/Ctrl + B` / `I` / `` ` `` | Toggle bold / italic / inline code |
| `Cmd/Ctrl + Opt/Alt + 1…6` | Set heading level (pressing the current level again returns it to a paragraph) |
| `Cmd/Ctrl + Opt/Alt + 0` | Set paragraph |

Heading shortcuts use `Opt/Alt` because Obsidian already binds `Cmd + 1…8` to switching tabs.

**Worth giving a hotkey.** These commands have no key until you give them one:

| Command | Why you'd want a key for it |
| --- | --- |
| **Search everywhere** | Tasks, notes, attachments, folders and tags in one search, from anywhere. It's the one most worth a key. If you'd like it to replace Obsidian's own search, give it `Cmd/Ctrl + Shift + F` and remove that key from *Search: Search in all files* (**Show in Obsidian search** still takes you there). |
| **Open notes sidebar** | Brings the sidebar back after you've closed it, or focuses it. |
| **Toggle WYSIWYG editing** | Switches between Plainsight's editor and plain Markdown, handy for a quick look at the raw text while the editor is in beta. |
| **Remove bookmarks to deleted notes** | Tidies Bookmarks. Rarely needed, so the palette is usually enough. |

To set one, open **Settings → Hotkeys** and search for *Plainsight*, or click **Set hotkeys** at the bottom of Plainsight's settings, which opens that list for you. Click the `+` next to a command and press the keys. Obsidian warns you if they're already in use. The editor shortcuts above can be changed there too.

## Hotkeys for Writing Tools and menus (Mac)

Apple Intelligence's **Writing Tools** (Summarize, Proofread, Rewrite and the rest) live in macOS's Edit menu, and Obsidian can't give menu items a hotkey. **[Plainsight Menu Commands](https://github.com/magnusmoaner/obsidian-plainsight-menu-commands)**, a companion plugin, turns each Writing Tool, and any other menu item you name, into an Obsidian command. Give *Summarize* a key, select text in a note, press it.

It's a plugin of its own because it needs access to macOS to pick menu items, and that would keep Plainsight off phones and tablets. It works with or without Plainsight. On a Mac, Plainsight's settings point to it under **Hotkeys**, and open its settings once it's installed.

## How Plainsight treats your notes

- **Markdown stays the source of truth.** No database and no separate copy. Everything shown comes from your files.
- **Edits are as small as possible.** Pinning edits one property line. Adding a tag edits only the `tags` property, keeping its existing formatting. Ticking a task changes one line, and only if that line is still the task that was shown. Nothing is ever re-saved through a YAML serializer that could drop comments or reformat the file.
- **If an edit can't be made safely, nothing is written.** For example, adding a tag to a `tags` property written in a format Plainsight doesn't recognise. You get a message explaining why instead.
- **Canvases are never written to.** They're JSON, and Plainsight's edits are line-based.
- **Other plugins keep working.** Plainsight never intercepts other plugins' edits, so formatting inserted by tools such as Better Edit or Editing Toolbar renders normally.

## Settings

The settings are grouped under five headings.

| Setting | Default | What it does |
| --- | --- | --- |
| ***Editor (beta, work in progress)*** | | |
| Enable WYSIWYG editing | On | Hides syntax and enables the editor shortcuts |
| Let Plainsight draw everything (Source mode) | Off | Switches notes from Live Preview to Source mode, so Plainsight alone draws them. Greyed out while the editor is off |
| ***Notes sidebar: left column*** | | |
| Action buttons | On | The Note button and the round buttons beside it, at the top of the left column. Everything they do stays reachable without it, through the `+` on Notes, Tasks, Folders and Tags and through the commands |
| Search, New folder, New task and ⋯ buttons | On | Each round button (greyed out while the action buttons are off). Search, New folder or New task turned off moves into the **⋯** menu |
| ***Notes sidebar: right column*** | | |
| Preview on hover | On | Resting the mouse on a note card or a task previews the note (needs the core Page preview plugin) |
| Gap at the top, bottom, left, right | Bottom only | A gap between the white list panel and the window edge on each chosen side; corners round on sides with a gap |
| ***Tasks*** | | |
| Default note for new tasks | (asked the first time) | Where the sidebar's New task button and the `+` on Tasks add tasks (any note except a Kanban board) |
| List Kanban cards as tasks | Off | The Kanban plugin saves cards as checkbox lines. Off: they show on the Tasks page only when grouped by Kanban board. On: every card is listed among your tasks |
| ***Hotkeys*** | | |
| Set hotkeys | — | Opens Settings → Hotkeys, showing only Plainsight's commands |
| Writing Tools and menu commands | — | On a Mac only: points to [Plainsight Menu Commands](https://github.com/magnusmoaner/obsidian-plainsight-menu-commands), or opens its settings once it's installed |

Settings live in the plugin's `data.json`, which syncs with your vault. If a sync service hasn't delivered that file yet when Obsidian starts, Plainsight uses the defaults and doesn't write over it: a change you make while the file can't be read, or within a minute of starting while it's missing, waits and is applied on top of your real settings once they arrive. A file that's still missing after that minute is treated as a fresh install, and your change is saved.

## Works with

Plainsight needs no other plugin. These add to it when they're installed and enabled; without one, its features are simply left out.

| Plugin | What it adds | Without it |
| --- | --- | --- |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | Ticking a task goes through Tasks, so done dates and recurring tasks work as in a note. New tasks use its format and global filter. Search can insert a ` ```tasks ` query. | Tasks are ticked by Plainsight itself; no recurrence handling and no query insert |
| [Kanban](https://github.com/mgmeyers/obsidian-kanban) | Its boards are listed with their card counts, tasks can be grouped by board, and new boards can be created | No Kanban boards |
| [Task List Kanban](https://github.com/erikars/task-list-kanban) | Its boards are listed as boards, and new ones can be created | No Task List Kanban boards |
| [Omnisearch](https://github.com/scambier/obsidian-omnisearch) | Typo-tolerant ranking and excerpts in Search everywhere | Plainsight's own ranking |
| [OCR Extractor](https://github.com/jritzi/ocr-extractor) | Writes a file's text into the note under its embed; Plainsight shows and searches that text with the file under Attachments | Attachments are found by name only (or by extracted-text notes) |
| [Importer](https://github.com/obsidianmd/obsidian-importer) | An Importer item in the **⋯** menu | The item is hidden |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | Nothing to set up: Dataview fields (`key:: value`) are shown cleaned up in card previews | — |

From Obsidian's core plugins, Plainsight uses **Bookmarks** (the Bookmarks place), **Templates** (the Templates place and *Insert template*), **Page preview** (hover previews), **Search** (*Show in Obsidian search*), **Quick switcher** and **Graph view** (in the **⋯** menu) and **Canvas** (canvases are listed and can be created). Each is optional in the same way.

### Good companions

Plainsight doesn't talk to these plugins, but together they make Obsidian feel more like a proper visual note editor:

- **[Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar)** puts bold, headings, lists and colours on buttons above the note, for when you'd rather click than remember a shortcut. Whatever it inserts, Plainsight draws like anything you type.
- **[Advanced Tables](https://github.com/tgrosinger/advanced-tables-obsidian)** keeps tables tidy while you type: columns line up, and Tab and Enter move between cells. Plainsight doesn't draw tables yet, so this makes the Markdown pleasant in the meantime.

**Pick one of the two:** [Notebook Navigator](https://github.com/johansan/notebook-navigator) is another notes sidebar, built for the same job as Plainsight's. Both can be on together, but you'd use one.

## The Plainsight family

Plainsight is also the name for a small family of Obsidian plugins with the same aim: Obsidian that feels calm and works like a proper note editor.

| Plugin | What it does |
| --- | --- |
| **Plainsight** (this one) | The editor without Markdown syntax, and the two-column notes sidebar |
| **[Plainsight Menu Commands](https://github.com/magnusmoaner/obsidian-plainsight-menu-commands)** | Hotkeys for Apple Intelligence's Writing Tools and any other menu item, on a Mac |

Each works on its own; together they fit.

## Installation

Plainsight isn't in the Community Plugins directory yet, and there are no releases yet either. To install it by hand:

1. Build it (see Development below), which produces `main.js`; `manifest.json` and `styles.css` are in the repo.
2. Copy those three files to `<your vault>/.obsidian/plugins/plainsight/`.
3. In Obsidian, go to Settings → Community plugins, reload, and enable **Plainsight**.

## Development

```bash
npm install
npm test          # vitest
npm run build     # type-check, then a production bundle (main.js)
npm run deploy    # build and copy into a vault
```

`npm run deploy` copies to the folder named by `OBSIDIAN_PLUGIN_DIR`, set in your environment or in a `.env.local` file (not committed): `OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/plainsight`. Reload Obsidian (`Cmd/Ctrl + R`) to pick up changes.

**Layout**
- `src/editor/`: the CodeMirror 6 extension. Plainsight runs its own incremental Lezer Markdown parse and builds the decorations, hidden delimiters and edit behaviour from that syntax tree.
- `src/sidebar/core/`: pure TypeScript (no `obsidian` import), tested in Node. This covers note summaries, the index, queries, task parsing and grouping, and the safe text edits.
- `src/sidebar/`: the Obsidian side. The view, the indexer that follows vault events, the dialogs, the write actions, and `internals.ts`, which isolates every undocumented Obsidian API in one place.

## Roadmap

In progress for the editor: link editing (a link toolbar, an Edit dialog and Cmd+K) and embeds (images, file chips, note previews). After that: frontmatter/properties, lists and task checkboxes, and tables. For the sidebar, Spaces are planned (folders grouped into named spaces).

## License

[MIT](LICENSE)
