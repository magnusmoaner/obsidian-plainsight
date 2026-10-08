# Plainsight

An Obsidian plugin for a calm, document-like note experience: Markdown that reads like a page instead of syntax, and a two-column notes sidebar that shows what's in a note before you open it.

Your files stay ordinary Markdown. Plainsight hides syntax and adds browsing on top; it never converts your notes into another format.

> **Status:** early and in active development. Not yet in the Community Plugins directory, and only tested on desktop (macOS).

## The editor

Formatting renders as you type, and the syntax never comes back: there's no "reveal the markup when the cursor gets close". Typing Markdown still works, because a construct converts the moment it's complete.

- **Bold, italic and inline code.** Delimiters stay hidden, and the caret moves past them like rich text. Backspace at the edge of a formatted span removes the formatting instead of exposing a `**`.
- **Headings.** `# ` disappears once you type the space, and each level is styled. Backspace at the start of a heading turns it back into a paragraph.
- **Callouts.** `> [!type]` blocks render as boxes while you edit them. A `···` button changes the callout type.

Anything Plainsight doesn't render yet (lists, links, tables and more) stays visible as plain Markdown and fully editable.

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
- **Bookmarks:** Obsidian's own bookmarks. Bookmarks to deleted notes are shown crossed out; click one to remove it.
- **Notes:** every note, with pinned notes first. Group by month, folder or type, or not at all; when a place holds more than plain notes, chips filter to Notes, Boards or Canvases.
- **Tasks:** tasks from all your notes. Filter by Open, Overdue or Done, or by a single note. Group by due date (completed tasks by the date they were done), folder, note, or Kanban board (as "Board › List", in the board's own list order). Ticking a task goes through the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin when it's installed, so done dates and recurring tasks behave exactly as they do inside a note.
- **Attachments:** PDFs, images and other files, with thumbnails. If a file has extracted-text notes (frontmatter `type: extracted-text` with a link to the file), they're listed with the file, their text is searchable from it, and they're kept out of your note lists.
- **Templates:** the core Templates folder. Clicking a template creates a new note from it.
- **Folders** and **Tags:** collapsible trees with counts. Folders that Obsidian uses for attachments are hidden.

**Note cards** show the title, the first useful line of text, task progress (`3/6`), the date, tags and a thumbnail. Canvases and Kanban boards appear with their own icons and counts; a board's archived cards aren't counted. Right-click a card to open it in a new tab or to the right, pin or unpin it, rename or delete it, plus the items other plugins add (such as Move file to…). Right-click a folder for New note, New folder, Rename and Delete.

**Creating things:** the **Note** button, the round **New folder** and **New task** buttons, and the `+` that appears when you hover Tasks, Folders or Tags. New tasks open the Tasks plugin's own dialog and are added to a note you choose once, which you can change later in settings. New tags are added to the note you have open. The **⋯** menu creates tags, canvases and Kanban boards, inserts a template into the open note, opens search, the quick switcher, the graph view and the Importer, and has expand/collapse all, bookmark cleanup and settings. Items for plugins you don't have (Kanban, Importer) are hidden.

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

Next for the editor are wikilinks, frontmatter/properties, lists and task checkboxes, tables, embeds and highlights. For the sidebar, Spaces are planned (folders grouped into named spaces).

## License

[MIT](LICENSE)
