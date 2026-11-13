# Plainsight

An Obsidian plugin for a calm, document-like note experience: Markdown that reads like a page instead of syntax, a two-column notes sidebar that shows what's in a note before you open it, and boards you can keep inside a note.

Your files stay ordinary Markdown. Plainsight hides syntax and adds browsing on top; it never converts your notes into another format.

For a tour with screenshots, see [plainsight.kodepartiet.dk](https://plainsight.kodepartiet.dk).

> **Status:** early and in active development. Not yet in the Community Plugins directory, and only tested on desktop (macOS). The editor is in beta and a work in progress; the notes sidebar is in daily use.

## The editor (beta, work in progress)

> **Beta, work in progress.** The editor draws only part of Markdown so far, more is being added (see below), and you may meet rough edges. It changes how notes look and how keys behave, never what's in your files, so switching it off (**WYSIWYG editing** in settings, or the *Toggle WYSIWYG editing* command) gives you plain Obsidian back at once. The sidebar works the same either way.

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
| **Bookmarks** | Obsidian's own bookmarks, with their bookmark group on the right. Bookmarks to deleted notes are crossed out; click one to remove it. The filters you save are listed after them (see [Search](#search)). |
| **Notes** | Every note, pinned notes first. Group by month, folder or type, or not at all. Chips filter to Notes, Boards or Canvases. |
| **Daily notes** | The core Daily notes folder. The `+` opens today's note. |
| **Tasks** | Tasks from all your notes. See below. |
| **Boards** | Every board in the vault: Plainsight's own, and those of the [Kanban](https://github.com/mgmeyers/obsidian-kanban) and [Task List Kanban](https://github.com/erikars/task-list-kanban) plugins. Chips filter by type of board; group by type, or by the note a board is embedded in. See [Boards](#boards). |
| **Attachments** | PDFs, images and other files, with thumbnails, searchable by the text inside them. Group by month, folder or file type, or not at all. See below. |
| **Templates** | The core Templates folder. The `+` makes a new template, or a board template. Click a template to open it; its **New note from template** button (also on right-click) makes a note from it in the folder you last viewed. A board template's button is **New board** instead: a new board with that template's lists. Right-click the **Note** button to pick a template from anywhere. |
| **Folders** and **Tags** | Collapsible trees with counts. Folders Obsidian uses for attachments are left out, and so are the daily notes and templates folders while they have a place of their own. |

Daily notes and Templates show while their core plugin is on. They, Tasks and Boards can each be turned off in settings. Until its folder is set, the place offers **Choose folder**, which opens that core plugin's settings.

**Tasks.** Filter by Open, Overdue or Done, or by a single note. Each task shows its note, plus badges for priority, due and scheduled dates ("Tomorrow"; overdue in red), recurrence and tags. Group by due date, scheduled date (done tasks by the day they were done), priority, recurrence, tag, folder, note or board ("Board › List", in the board's order). The task under your cursor in a note is highlighted in the list. Ticking a task goes through the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin when it's installed, so done dates and recurring tasks behave exactly as inside a note.

**Attachments.** A file's extracted text is its card's preview and makes it findable by what it says. The text comes from [OCR Extractor](https://github.com/jritzi/ocr-extractor)'s *Extracted text* boxes under the file's embeds, or from extracted-text notes (frontmatter `type: extracted-text` with a link to the file), which are listed with the file and kept out of your note lists. Right-click a file for:
- **Open extracted text**, which jumps to the box or note holding its text;
- **Open containing note**, which opens each note that embeds or links the file, at that spot (greyed out when no note does).

### Note cards

Each card shows the title, the first useful line of text, task progress (`3/6`), the date, tags and a thumbnail. Canvases and boards get their own icons. A board shows its lists as tiles: each has the list's name and card count, the names of its first cards (three, or two and "+N more" when there are more), the list's colour if it has one, and a line for how many cards are done. Archived cards aren't counted. A board with more than four lists shows three, and a narrow "+N" tile that names the rest when you hover it. A Task List Kanban board is labelled as one, since its cards are tasks from your other notes. A note with a board embedded in it shows that board's lists under its text, as slimmer tiles with name and count, and counts its cards in the task progress.

Right-click a card to open it in a new tab or to the right, pin or unpin it, rename or delete it, plus whatever other plugins add (such as *Move file to…*). Right-click a folder for New note, New folder, Rename and Delete.

### Drag and drop

Cards, folders and tasks can be dragged. A copy of what you're dragging follows the pointer, with a line beside the pointer saying what a drop would do.

| Drag | Onto | What happens |
| --- | --- | --- |
| A card: a note, board, daily note, template or attachment | A folder in the left column | It moves there. Links to it are updated |
| A note's card | A tag in the left column | The note gets that tag |
| A note's card | **Templates** | It moves into the templates folder |
| A folder | Another folder, or the **Folders** heading | It moves inside that folder, or to the top level |
| A card or a folder | An open note, a tab or File explorer | What Obsidian does with a file dragged from File explorer: a link in the note, the file opened in the tab, a move in File explorer |
| A task in the Tasks list | An open note | The task moves to the line you drop it on (a mark shows where), with its subtasks, and leaves the note it was in |
| A task in the Tasks list | A list on an open board | The task becomes a card where you drop it and leaves its note. Over the board the copy turns into a card, and an empty slot shows where it would land. In a list with a status, it takes that status |
| A task in the Tasks list | A bookmarked note in the left column | The task moves to the end of that note |

A folded folder opens when a drag rests on it. Nothing is overwritten: a move that would land on something with the same name is refused, with a message. Files dragged out of File explorer can be dropped on Plainsight's folders and tags too. A task is always moved, never copied: it is written to its new place first and only then taken out of the old one, so it can't get lost on the way. Dragging uses Obsidian's own drag handling, on desktop.

### Previews

Rest the mouse on a card to preview the note or file beside the list; rest it on a task to preview its note, scrolled to the task. This is Obsidian's core Page preview:
- To preview only while Cmd/Ctrl is held, turn on **Plainsight** in Page preview's settings.
- To turn previews off, switch off **Preview on hover** in Plainsight's settings.
- Files with `#` in their name get no preview, since Page preview reads `#` as the start of a heading.

### Creating things

- **The button row** at the top of the left column: the **Note** pill, then round buttons for **Search**, **Daily note** (today's note, while the Daily notes core plugin is on), **New folder**, **New task** and **⋯**. Settings can hide the whole row, or any of the round buttons; a hidden Search, Daily note, New folder or New task button (and, one at a time as the column narrows, New folder, New task and Daily note) moves into the **⋯** menu. Right-click the **Note** pill for **New note from template…**.
- **A `+`** appears when you hover Notes, Daily notes (today's note), Tasks, Boards (a new board), Templates (a new template, or a choice of **New template** and **New board template** while boards are on), Folders or Tags (not on touch screens).
- **The list header** has a button for a new note (a new task on Tasks, today's note on Daily notes, a new template on Templates). Outside Daily notes and Templates, a second one makes a new board in the folder you're viewing: Plainsight's own, or, with the [Kanban](https://github.com/mgmeyers/obsidian-kanban) or [Task List Kanban](https://github.com/erikars/task-list-kanban) plugin enabled, a choice of kinds. On Boards, the first button makes a Plainsight board and the second the plugins' kinds. On Templates, the second makes a board template: a Plainsight board with the default lists, in the templates folder, ready to be named under **Template for new boards** in the settings.
- **The ⋯ menu** creates tags, canvases and boards, inserts a template into the open note, opens Obsidian's search, quick switcher, graph view and the Importer, and has expand/collapse all, bookmark cleanup and settings.

Buttons and menu items for plugins that aren't enabled are hidden.

**New tasks** open a quick-add dialog. Type the task, then optionally pick a due date (Today, Tomorrow, Next week or any date), a priority, a repeat (daily, weekdays, weekly, monthly or yearly, optionally counted from when it's done) and which note it goes into. **More details** adds scheduled and start dates. The task is written in the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin's format, including its global filter and created date if you use them, at the end of a note you choose once (changeable in settings, or per task).

**New tags** are added to the note you have open.

### Search

- **Search everywhere** (the round **Search** button, or the command, which is worth a hotkey) looks through tasks, boards, notes, attachments (by name and by their text), folders and tags at once. The best matches come first, with excerpts, grouped by kind: filters, folders and tags, tasks, boards, notes, then attachments. Choosing a result shows it in the sidebar too. **Show in Obsidian search** hands the query to Obsidian's own search. With [Omnisearch](https://github.com/scambier/obsidian-omnisearch) installed, its typo-tolerant ranking orders the notes and attachments. With Tasks installed, **Insert as Tasks query** puts the search into your note as a ` ```tasks ` block.
- **The search field above the list** narrows the list you're looking at, keeping its order and grouping. It's cleared when you switch to another list.
- **Filters.** A filter is a search you save. With something typed in a list's search field, a **Save as a filter** button appears beside the list's other buttons; give the filter a name (the dialog lists what it will hold). It's kept in the left column at the end of the Bookmarks section, which is then headed **Bookmarks & filters**, with a filter icon and the list it belongs to. Click it to open that list with the search filled in, and grouped, sorted and with the same chip chosen as when you saved it (on Tasks, the tab it was saved on). To change one, open it, change what's typed and save it again under the same name. Right-click one to rename or remove it. Search everywhere finds filters by name, first in its results. They're stored in Plainsight's settings, so they sync with the vault.

Search everywhere and the search field understand the same queries:

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
- **Per device.** Folded sections, column width, grouping and the filter chips are remembered on each device and don't sync, so your phone and computer can each keep their own (Obsidian 1.8.7 or later). The Boards list's filter by type of board isn't remembered; it starts on All.

## Boards

A board is a set of lists holding cards, for a project, a trip or a week. Plainsight has its own, and they live where your notes do.

- **A new board** starts with three lists: Inbox, Doing (blue) and Done (green), with Done marking its cards done. To start from your own lists instead, set up a board the way you like it and name it under **Template for new boards** in the settings: every new board is then a copy of it, lists, colours, cards and all. `{{title}}`, `{{date}}` and `{{time}}` in it are filled in as in any template.
- **On a page of its own, or inside a note.** A board opens as a board from the sidebar, the file explorer or a link. To put one inside a note, run **Insert new board** (it makes `<note name> board` next to the note and embeds it) or **Embed existing board**. An embedded board is worked on in place, without leaving the note.
- **Cards.** Add, edit, tick, drag and delete them. A dragged card hangs from the pointer, with a line beside it naming the list a drop would put it in, and leaves an empty slot where it would land. A card is edited in Obsidian's own editor, so links and tags complete as you type, and with the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin its suggestions for dates, priority and recurrence come up too. Those details, and tags at the start or end of the card, show as badges along the bottom of the card.
- **Statuses.** A card is open `[ ]`, in progress `[/]`, done `[x]` or cancelled `[-]`, set from its menu. Ticking a card goes through the Tasks plugin when it's installed, so the card gets its done date and a repeating card leaves its next round behind.
- **Lists.** Rename, drag to reorder (by its header, with the same hanging copy and empty slot), minimize or delete a list from its header and menu. On a Plainsight board a list can also have a colour, one of eight that follow your theme, shown on the board and on its tile in the note list. A list can give a status to the cards that land in it (in progress, done or cancelled); a card that leaves for a plain list is open again. New lists are added on the board's own page, with the **+** after the last list or the one at the page's top right; the new list's name is ready to type over.
- **About the board.** On its own page a board starts with its name, a description, its tags and the notes it's embedded in, each a link. Click the name to rename the board, or the description to write or change it; **Tag** adds a tag. A board that isn't in any note yet offers **Embed in note**, which puts it at the end of a note you pick. Both are ordinary properties of the board's note (`description` and `tags`), so the tags also show on the board's card and under Tags.

**A board is a Markdown note.** Each list is a `## ` heading and each card a checkbox line under it, which is the Kanban plugin's file format. A Plainsight board is marked `plainsight-plugin: board` in its properties; one made by the Kanban plugin is marked `kanban-plugin`, and that plugin keeps opening it. Every edit changes only the lines of the cards or lists involved.

```markdown
---
plainsight-plugin: board
---

## To do

- [ ] Order the tiles 📅 2026-11-15 ⏫
- [ ] Pick a tap #shopping

## Done

**Complete**
- [x] Choose the worktop ✅ 2026-11-06
```

**The embed** is a code block naming the board. A board embedded with one of the two commands lists that note in turn, in an `embedded-in` property, so when the board is renamed the block follows. (A block you type yourself works too; it just isn't followed on a rename.)

````markdown
```plainsight-board
board: [[Kitchen renovation board]]
```
````

Good to know:

- **Kanban plugin boards** can be embedded and edited the same way. Without that plugin, Plainsight opens them on its own board page. A list's done status and its minimized state are stored the way the Kanban plugin stores them, so both agree; in-progress and cancelled lists are Plainsight's own and are kept in the board's settings block, which Kanban leaves alone. List colours are kept there too, and are for Plainsight boards only: a Kanban plugin board shows none.
- **`kanban-embed` blocks**, from the Kanban Embed plugin, are drawn too while that plugin is off (reload Plainsight after switching it).
- **Open as Markdown**, a button on the board page, shows the note behind a board.
- **With "Let Plainsight draw everything (Source mode)" on**, an embedded board shows as its code block for now.
- **Task List Kanban boards** gather tasks from other notes, so they have no lists of their own to embed.

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

The board commands, **Insert new board**, **Embed existing board** and **Open this note as a board**, are in the palette too.

To set one, open **Settings → Hotkeys** and search for *Plainsight*, or click **Set hotkeys** at the bottom of Plainsight's settings, which opens that list for you. Click the `+` next to a command and press the keys. Obsidian warns you if they're already in use. The editor shortcuts above can be changed there too.

## How Plainsight treats your notes

- **Markdown stays the source of truth.** No database and no separate copy. Everything shown comes from your files.
- **Edits are as small as possible.** Pinning edits one property line. Adding a tag edits only the `tags` property, keeping its existing formatting. Ticking a task changes one line, and only if that line is still the task that was shown. Nothing is ever re-saved through a YAML serializer that could drop comments or reformat the file.
- **If an edit can't be made safely, nothing is written.** For example, adding a tag to a `tags` property written in a format Plainsight doesn't recognise. You get a message explaining why instead.
- **Boards are edited line by line.** Moving a card moves its lines; nothing else in the file is rewritten, so the archive and settings block of a Kanban board stay as they were. An edit on a card that changed underneath is refused, not guessed.
- **Canvases are never written to.** They're JSON, and Plainsight's edits are line-based.
- **Other plugins keep working.** Plainsight never intercepts other plugins' edits, so formatting inserted by tools such as Better Edit or Editing Toolbar renders normally.

## Settings

The settings are in five groups. A setting that depends on another shows only while that one is on.

| Setting | Default | What it does |
| --- | --- | --- |
| ***Sidebar*** | | |
| Action buttons | On | The Note button and the round buttons beside it, at the top of the left column. Everything they do stays reachable without it, through the `+` on Notes, Tasks, Folders and Tags and through the commands |
| Search, Daily note, New folder, New task and ⋯ buttons | On | Each round button. Daily note shows only while the Daily notes core plugin is on. Search, Daily note, New folder or New task turned off moves into the **⋯** menu |
| Preview on hover | On | Resting the mouse on a note card or a task previews the note (needs the core Page preview plugin) |
| Gaps around the note list | Bottom only | Four switches, for top, bottom, left and right: a gap between the white list panel and the window edge on each chosen side; corners round on sides with a gap |
| ***Side menu*** | | |
| Daily notes, Templates | On | The place, while its core plugin is on. Its folder is listed there instead of under Folders. The row says where the place stands, with a button to turn the core plugin on, choose its folder or change it |
| Boards | On | The Boards place, below Tasks |
| Filters | On | Filters (searches you save) in the Bookmarks section, and the button that saves one. Off hides both and keeps your filters |
| ***Tasks*** | | |
| Tasks | On | The Tasks place, the New task buttons, the task progress on note cards and tasks in Search everywhere. Off hides them; your tasks stay in your notes |
| Default note for new tasks | (asked the first time) | Where the sidebar's New task button and the `+` on Tasks add tasks (any note except a board) |
| Board cards as tasks | Off | A board saves cards as checkbox lines. Off: they show on the Tasks page only when grouped by board. On: every card is listed among your tasks |
| ***Boards*** | | |
| Boards | On | Plainsight's boards, and the look of boards in the sidebar. Off: a board is listed like any other note, its cards are ordinary tasks, and an embedded board shows as its code block |
| Kanban plugin boards | On | Boards made with the Kanban plugin count as boards. Off: they're listed like any other note |
| Task List Kanban boards | On | The same, for the Task List Kanban plugin |
| Template for new boards | (none) | A board or note that every new Plainsight board starts as a copy of, in place of the default lists. Chosen from your templates folder, if the Templates core plugin has one set; otherwise any note |
| Narrowest list | 190 | How narrow a list on a board may get, in pixels (150 to 400), before the board scrolls sideways |
| ***Editor (beta)*** | | |
| WYSIWYG editing | On | Hides syntax and enables the editor shortcuts |
| Let Plainsight draw everything (Source mode) | Off | Switches notes from Live Preview to Source mode, so Plainsight alone draws them |
| Hotkeys | — | **Set hotkeys** opens Settings → Hotkeys, showing only Plainsight's commands |

Settings live in the plugin's `data.json`, which syncs with your vault. If a sync service hasn't delivered that file yet when Obsidian starts, Plainsight uses the defaults and doesn't write over it: a change you make while the file can't be read, or within a minute of starting while it's missing, waits and is applied on top of your real settings once they arrive. A file that's still missing after that minute is treated as a fresh install, and your change is saved.

## Works with

Plainsight needs no other plugin. These add to it when they're installed and enabled; without one, its features are simply left out.

| Plugin | What it adds | Without it |
| --- | --- | --- |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | Ticking a task or a board card goes through Tasks, so done dates and recurring tasks work as in a note. New tasks use its format and global filter. Its suggestions come up while you type a card. Search can insert a ` ```tasks ` query. | Tasks and cards are ticked by Plainsight itself; no done dates or recurrence handling, and no query insert |
| [Kanban](https://github.com/mgmeyers/obsidian-kanban) | Its boards are listed with their lists and card counts, can be embedded in notes, and open in Kanban's own view. New Kanban boards can be created | Plainsight opens Kanban boards on its own board page |
| [Task List Kanban](https://github.com/erikars/task-list-kanban) | Its boards are listed as boards, and new ones can be created | No Task List Kanban boards |
| [Omnisearch](https://github.com/scambier/obsidian-omnisearch) | Typo-tolerant ranking and excerpts in Search everywhere | Plainsight's own ranking |
| [OCR Extractor](https://github.com/jritzi/ocr-extractor) | Writes a file's text into the note under its embed; Plainsight shows and searches that text with the file under Attachments | Attachments are found by name only (or by extracted-text notes) |
| [Importer](https://github.com/obsidianmd/obsidian-importer) | An Importer item in the **⋯** menu | The item is hidden |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | Nothing to set up: Dataview fields (`key:: value`) are shown cleaned up in card previews | — |

From Obsidian's core plugins, Plainsight uses **Bookmarks** (the Bookmarks place), **Daily notes** (the Daily notes place), **Templates** (the Templates place and *Insert template*), **Page preview** (hover previews), **Search** (*Show in Obsidian search*), **Quick switcher** and **Graph view** (in the **⋯** menu) and **Canvas** (canvases are listed and can be created). Each is optional in the same way.

### Good companions

Plainsight doesn't talk to these plugins, but they go well with it:

- **[Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar)** puts bold, headings, lists and colours on buttons above the note, for when you'd rather click than remember a shortcut. Whatever it inserts, Plainsight draws like anything you type.
- **[Task Board](https://github.com/tu2-atmanand/Task-Board)** gathers the tasks from every note onto one board, where you can view and manage them. It works from the same task lines Plainsight lists, so it's another view of them, not a copy.
- **[QuickAdd](https://github.com/chhoumann/quickadd)** adds a note or a line of text to your vault from a hotkey: capture a thought into your inbox, or start a note from a template, without leaving what you're doing. What it adds shows up in Plainsight like anything else.
- **[Advanced URI](https://github.com/Vinzent03/obsidian-advanced-uri)** gives your vault links that work from outside Obsidian: a link that opens a note, makes a new one or runs a command, for a shortcut, a script or another app. A note it opens shows up in Plainsight like any other.

**Pick one of the two:** [Notebook Navigator](https://github.com/johansan/notebook-navigator) is another notes sidebar, built for the same job as Plainsight's. Both can be on together, but you'd use one.

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
- `src/boards/`: boards. `board.ts` is pure TypeScript: it reads a board file and makes every edit, line by line. The rest draws a board (in a note or on its page), embeds Obsidian's editor in a card, and registers the commands.
- `src/sidebar/core/`: pure TypeScript (no `obsidian` import), tested in Node. This covers note summaries, the index, queries, task parsing and grouping, and the safe text edits.
- `src/sidebar/`: the Obsidian side. The view, the indexer that follows vault events, the dialogs, the write actions, and `internals.ts`, which isolates every undocumented Obsidian API in one place.

## Roadmap

In progress for the editor: link editing (a link toolbar, an Edit dialog and Cmd+K) and embeds (images, file chips, note previews). After that: frontmatter/properties, lists and task checkboxes, and tables. Embedded boards aren't drawn yet with Source mode on. For the sidebar, Spaces are planned (folders grouped into named spaces).

## License

[MIT](LICENSE)
