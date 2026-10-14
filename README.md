# Plainsight

An Obsidian plugin for a calm, document-like note experience: Markdown that reads like a page instead of syntax, and a two-column notes sidebar that shows what's in a note before you open it.

Your files stay ordinary Markdown. Plainsight hides syntax and adds browsing on top; it never converts your notes into another format.

> **Status:** early and in active development. Not yet in the Community Plugins directory, and only tested on desktop (macOS).

## The editor

Formatting renders as you type, and the syntax never comes back: there's no "reveal the markup when the cursor gets close". Typing Markdown still works, because a construct converts the moment it's complete.

- **Bold, italic and inline code.** Delimiters stay hidden, and the caret moves past them like rich text. Backspace at the edge of a formatted span removes the formatting instead of exposing a `**`.
- **Headings.** `# ` disappears once you type the space, and each level is styled. Backspace at the start of a heading turns it back into a paragraph.
- **Callouts.** `> [!type]` blocks render as boxes while you edit them. A `···` button changes the callout type.
- **Links.** Only the link text shows: `[text](url)` shows *text*, `[[Note|alias]]` shows *alias*, `[[Note#Section]]` shows *Note › Section*, and bare URLs show shortened (`github.com/…/repo`). Text you wrote (link text, aliases) stays editable in place; text derived from the target moves as one unit. A plain click places the cursor; **Cmd/Ctrl+click opens** the link (add Opt/Alt to open it to the right). Links to notes that don't exist get a dashed underline, and imported `evernote:///` links are muted.

Anything Plainsight doesn't render yet (lists, tables, embeds and more) stays visible as plain Markdown and fully editable.

### Live Preview vs Source mode

Obsidian's Live Preview draws some blocks, such as callouts, itself, and turns them back into Markdown when you click in. To make Plainsight the only renderer, turn on **Take over rendering (Source mode)**. Your previous editor mode is restored when you turn it off. The trade-off is that in Source mode anything Plainsight doesn't render yet shows as Markdown.

### Shortcuts

| Keys | Action |
| --- | --- |
| `Cmd/Ctrl + B` / `I` / `` ` `` | Toggle bold / italic / inline code |
| `Cmd/Ctrl + Opt/Alt + 1…6` | Set heading level (pressing the current level again returns it to a paragraph) |
| `Cmd/Ctrl + Opt/Alt + 0` | Set paragraph |

Heading shortcuts use `Opt/Alt` because Obsidian already binds `Cmd + 1…8` to switching tabs.

## The notes sidebar

It replaces File explorer with two columns: places on the left, and the selected place's contents on the right.

**Places**
- **Bookmarks:** Obsidian's own bookmarks, each showing its bookmark group (if any) on the right. Bookmarks to deleted notes are shown crossed out; click one to remove it.
- **Notes:** every note, with pinned notes first. Group by month, folder or type, or not at all; when a place holds more than plain notes, chips filter to Notes, Boards or Canvases. Boards are [Kanban](https://github.com/mgmeyers/obsidian-kanban) boards and [Task List Kanban](https://github.com/erikars/task-list-kanban) boards.
- **Tasks:** tasks from all your notes. Filter by Open, Overdue or Done, or by a single note. Group by due date (completed tasks by the date they were done), folder, note, or Kanban board (as "Board › List", in the board's own list order). The task under your cursor in a note is highlighted in the list, like the open note's card. Ticking a task goes through the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin when it's installed, so done dates and recurring tasks behave exactly as they do inside a note.
- **Attachments:** PDFs, images and other files, with thumbnails. If a file has extracted-text notes (frontmatter `type: extracted-text` with a link to the file), they're listed with the file, their text is searchable from it, and they're kept out of your note lists.
- **Templates:** the core Templates folder. Clicking a template creates a new note from it.
- **Folders** and **Tags:** collapsible trees with counts. Folders that Obsidian uses for attachments are hidden.

**Note cards** show the title, the first useful line of text, task progress (`3/6`), the date, tags and a thumbnail. Canvases and boards appear with their own icons. A Kanban board shows how many cards it holds (archived cards aren't counted); a Task List Kanban board is labelled as one instead, since its cards are tasks from your other notes. Right-click a card to open it in a new tab or to the right, pin or unpin it, rename or delete it, plus the items other plugins add (such as Move file to…). Right-click a folder for New note, New folder, Rename and Delete.

**Creating things:** the **Note** button, the round **New folder** and **New task** buttons, and the `+` that appears when you hover Tasks, Folders or Tags. New tasks open a quick-add dialog: type the task, then optionally set a due date (Today, Tomorrow, Next week or any date), a priority, a repeat (daily, weekdays, weekly, monthly, yearly, optionally counted from when it's done) and which note it goes into; **More details** expands the dialog with scheduled and start dates. The task is written in the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin's format (including its global filter and created date, if you use them) and added to the end of a note you choose once (changeable in settings, or per task in the dialog). New tags are added to the note you have open. The **⋯** menu creates tags, canvases and Kanban boards, inserts a template into the open note, opens search, the quick switcher, the graph view and the Importer, and has expand/collapse all, bookmark cleanup and settings. Items for plugins you don't have (Kanban, Importer) are hidden.

**Starting up:** the sidebar opens straight away. Notes are read most recently changed first, so your latest notes show almost at once; a thin progress bar under the list header runs until the rest are read, and then the full list and the counts appear.

**Per device:** folded sections, the column width, how lists are grouped, and the Notes/Boards/Canvases and Open/Overdue/Done filters are remembered on each device and don't sync, so your phone and your computer can each keep their own. (This needs Obsidian 1.8.7 or later; older versions forget them on restart.)

Turn off the core **File explorer** (Settings → Core plugins) to use the sidebar in its place.

## How Plainsight treats your notes

- **Markdown stays the source of truth.** No database and no separate copy. Everything shown comes from your files.
- **Edits are as small as possible.** Pinning edits one property line. Adding a tag edits only the `tags` property, keeping its existing formatting. Ticking a task changes one line, and only if that line is still the task that was shown. Nothing is ever re-saved through a YAML serializer that could drop comments or reformat the file.
- **If an edit can't be made safely, nothing is written.** For example, adding a tag to a `tags` property written in a format Plainsight doesn't recognise. You get a message explaining why instead.
- **Canvases are never written to.** They're JSON, and Plainsight's edits are line-based.
- **Other plugins keep working.** Plainsight never intercepts other plugins' edits, so formatting inserted by tools such as Better Edit or Editing Toolbar renders normally.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Enable WYSIWYG editing | On | Hides syntax and enables the editor shortcuts |
| Take over rendering (Source mode) | Off | Turns Live Preview off so Plainsight is the only renderer |
| Notes sidebar | On | Shows the two-column sidebar |
| Default note for new tasks | (asked the first time) | Where the sidebar's "New task" adds tasks (any note except a Kanban board) |
| Show Kanban cards in Tasks | Off | Kanban cards are checkbox lines too; off keeps them out of Tasks |

Settings live in the plugin's `data.json`, which syncs with your vault. If a sync service hasn't delivered that file yet when Obsidian starts, Plainsight uses the defaults and doesn't write over it: a change you make while the file can't be read, or within a minute of starting while it's missing, waits and is applied on top of your real settings once they arrive. A file that's still missing after that minute is treated as a fresh install, and your change is saved.

## Installation

Plainsight isn't in the Community Plugins directory yet. To install it manually:

1. Build it (see below), or take `main.js`, `manifest.json` and `styles.css` from a release.
2. Copy those three files to `<your vault>/.obsidian/plugins/plainsight/`.
3. In Obsidian, go to Settings → Community plugins, reload, and enable **Plainsight**.

## Development

```bash
npm install
npm test          # vitest
npm run build     # type-check, then a production bundle (main.js)
npm run deploy    # build and copy into a vault
```

`npm run deploy` copies to a default vault path. Set `OBSIDIAN_PLUGIN_DIR` to deploy to your own vault's `.obsidian/plugins/plainsight` folder instead. Reload Obsidian (`Cmd/Ctrl + R`) to pick up changes.

**Layout**
- `src/editor/`: the CodeMirror 6 extension. Plainsight runs its own incremental Lezer Markdown parse and builds the decorations, hidden delimiters and edit behaviour from that syntax tree.
- `src/sidebar/core/`: pure TypeScript (no `obsidian` import), tested in Node. This covers note summaries, the index, queries, task parsing and grouping, and the safe text edits.
- `src/sidebar/`: the Obsidian side. The view, the indexer that follows vault events, the dialogs, the write actions, and `internals.ts`, which isolates every undocumented Obsidian API in one place.
- `docs/plans/`: design documents and implementation plans, dated.

## Roadmap

In progress for the editor: link editing (a link toolbar, an Edit dialog and Cmd+K) and embeds (images, file chips, note previews). After that: frontmatter/properties, lists and task checkboxes, tables and highlights. For the sidebar, Spaces are planned (folders grouped into named spaces).

## License

[MIT](LICENSE)
