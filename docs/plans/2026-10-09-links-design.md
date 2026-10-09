# Links Design (M6)

Date: 2026-10-09
Status: Approved direction (Magnus, 2026-10-09); details below are the build spec.

## Problem

Clicking a link tries to open it, and putting the cursor in it reveals the raw Markdown: `[Aeven + Sentia](evernote:///view/13341093/s116/…)`. That breaks the plugin's core promise: never show syntax. Links are also the most common construct in the vault:

| Kind | Count |
| --- | --- |
| External `[text](https://…)` | 16,212 |
| Bare URLs | 5,597 |
| Wikilinks `[[…]]` (1,048 aliased, 108 to a heading) | ~1,800 |
| Internal Markdown links `[text](note.md)` | 346 |
| `evernote:///` links (dead) | 470 |
| Embeds (images ~9,400, PDFs 1,265, Office ~600) | ~12,000 |

## Decisions

- **Only the link text shows, never syntax, cursor inside or not.** `[[Note|alias]]` shows *alias*, `[[Note#Section]]` shows *Note › Section*, and `[text](url)` shows *text*.
- **A plain click edits; Cmd/Ctrl+click opens.** A click puts the caret in the link and shows a small toolbar: Open · Edit · Copy · Remove link. Cmd+hover shows Obsidian's page preview.
- **The Edit dialog** opens from the toolbar, from right-click → "Edit link…", or with Cmd+K. It has *Text* and *Link to* fields. *Link to* suggests notes, headings and attachments, or accepts a URL. Notes are written as wikilinks, URLs as Markdown links.
- **Creating links:** Cmd+K with text selected links it, and without a selection inserts a new link. Pasting a URL over selected text links that text. `[[` keeps Obsidian's own note suggester.
- **Backspace right after a link** removes the link and keeps its text.
- **Embeds:** images render inline, PDFs and Office files show as a file chip, and embedded notes show a preview card.
- **`evernote:///` links** show as text marked "Evernote link (not in vault)". Repairing them needs the importer to record Evernote IDs, which is out of scope here.

## Parsing

`@lezer/markdown` has no wikilinks: `[[Note]]` parses as a shortcut-reference `Link` around `[Note]`, and `![[x]]` as an `Image`. A `WikiLinks` inline-parser extension is added to `src/editor/parser.ts`: `baseParser.configure([GFM, WikiLinks])`. The prototype for this design was run with node:

- **Registration:** registered `before: "Link"`, so it handles both `[[` and `![[`. `Escape` and `InlineCode` still run first, and code blocks never run inline parsers.
- **Nodes:** `WikiLink` / `Embed` with children `WikiMark` (`[[`, `![[`, `]]`), `WikiTarget`, `WikiSubpath` (`#H1#H2` or `#^id`), `WikiAliasMark` (`|`, or `\|` in tables) and `WikiAlias`.
- **Rules:** a wikilink never spans lines; the target may not contain `[` or `]`; the first `|` splits off the alias. An invalid `[[` (`[[]]`, `[[ ]]`, an unclosed one) is consumed as **literal text**, so Link can't pair its brackets into something the renderer would then hide.
- **Verified:** 47 syntax cases. 3,000 random edits on a 26KB document gave **0 mismatches** between incremental and full reparse; an incremental reparse takes about 0.1ms, a full parse about 2.4ms.
- **A pure helper** `readWiki(node, doc)` returns `{embed, path, subpath[], blockRef, alias, width, height, display}`. It's node-testable. Embed sizing comes from the last `|` segment matching `\d+(x\d+)?`.

**Brackets without a URL:** `[foo]` (and the leftover from `\[[Note]]`) is still a lezer `Link`. It's rendered as **plain text**, not hidden, unless a matching `LinkReference` exists in the note. Otherwise brackets in ordinary prose would vanish.

## What's rendered

| Source | Visible | Hidden (atomic) | Style |
| --- | --- | --- | --- |
| `[text](url)` | text | `[`, `](url)` | link colour; external icon for http(s) |
| `[text](note.md)` | text | as above | internal link; dashed if unresolved |
| `[[Note]]` | Note | `[[`, `]]` | internal link; dashed if unresolved |
| `[[Note\|alias]]` | alias | `[[Note\|`, `]]` | internal link |
| `[[Note#A#B]]` | Note › A › B | all syntax (a widget shows the display) | internal link |
| `<https://x>`, bare `https://x` | shortened (`host/…/last`) via widget; full URL in tooltip | the URL text | link colour |
| `[t](evernote:///…)` | t | the URL | muted, with an "Evernote link (not in vault)" tooltip |
| `![[img.png\|300]]` | image widget (block, width 300) | whole source | — |
| `![[doc.pdf]]`, Office files | file chip widget (icon, name, size) | whole source | — |
| `![[Note]]` | preview card widget (title + first lines, via the sidebar's snippet code) | whole source | — |
| `![alt](img.png)` | image widget | whole source | — |

**Which text is editable**
- Text the user wrote themselves is ordinary editable text: a Markdown link's `text`, a wikilink's alias.
- Text *derived* from the target (an unaliased `[[Note]]`, a `Note › Section` display, a shortened URL) is shown by a widget and is **atomic**. The caret passes over it as one unit and only the Edit dialog changes it. Typing over a target name would silently change which note the link points to, so it isn't allowed.

## Caret and edit semantics

- **Typing at a link's edges goes outside it**, like rich-text editors, matching the existing inline marks. Typing inside alias or link text edits that text.
- **Backspace right after a link** removes the link syntax and keeps the visible text as plain text. For an unaliased wikilink that text is the target name. This mirrors the "unformat" rule for bold.
- **Backspace on the last character of editable link text** removes the whole link, so no empty `[](url)` is left behind.
- **Delete just before a link** mirrors Backspace.
- **A selection that covers a whole link, or crosses one**, deletes or replaces as ordinary text; the hidden syntax inside the selection goes with it. **A selection that covers only part of a link's text** edits just the text, never the hidden parts.
- Undo is one step per action. Every toolbar and dialog action is a single transaction.

## Interactions

- **Click:** places the caret. When the caret is inside a link, a floating toolbar appears under it: **↗ Open · ✎ Edit · ⧉ Copy link · ✕ Remove link**. It hides when the caret leaves.
- **Cmd/Ctrl+click:** opens the link. Internal targets go through `workspace.openLinkText(linktext, sourcePath, newLeaf)`; Cmd+Opt+click opens to the right. External URLs open through Obsidian's normal external-link handling. An unresolved wikilink creates the note, as Obsidian does.
- **Cmd+hover:** triggers Obsidian's `hover-link` event, so the core Page preview plugin shows its popover. Page preview only shows it while Cmd is held, so there's no extra rule to add.
- **Right-click:** the editor records where the click landed (a CodeMirror `contextmenu` handler, using `posAtCoords`). The `editor-menu` event then adds **Edit link… / Open link / Copy link / Remove link** when that position is inside a link.
- **Cmd+K:** handled in our `Prec.high` keymap, like Cmd+B. It overrides Obsidian's default "Insert Markdown link" binding. With text selected it links the selection; inside a link it edits that link; otherwise it inserts a new one.
- **The Edit dialog:**
  - *Text* and *Link to* fields. *Link to* suggests notes, headings (`Note#…`) and attachments as you type, through an `AbstractInputSuggest`, like the sidebar's dialogs.
  - It writes `[[Target]]` or `[[Target|Text]]` for vault targets, respecting Obsidian's "use wikilinks" setting, and `[Text](url)` for URLs.
  - It keeps whichever form the link already used, unless *Link to* changes kind (note ↔ URL).
- **Pasting a URL over selected text** links it: our own paste handler, inside the editor only, and only when the selection is non-empty and the clipboard is exactly one URL. Every other paste passes through untouched.
- **`[[`:** Obsidian's link suggester is left alone. The link renders the moment `]]` lands. Still to confirm in the app: the suggester works with Live Preview off (Source mode).
- **Touch:** with no Cmd key or hover, a tap places the caret and shows the toolbar, and the toolbar's Open opens.

## Writes to notes

Every action is one text replacement over the link's own range:

| Action | Edit |
| --- | --- |
| Remove link (toolbar, Backspace) | link range → its visible text (alias, link text, or target name) |
| Edit dialog | link range → the rebuilt link |
| Cmd+K / paste over selection | selection → `[sel](url)` or `[[target\|sel]]` |
| Insert link | `[[target]]` or `[text](url)` at the caret |

Inside a table cell, a written alias pipe is `\|`; an unescaped `|` would split the cell. Nothing outside the link's range ever changes.

## Architecture

- **`src/editor/wikilinks.ts`:** the parser extension plus `readWiki`. Pure and node-tested.
- **`src/editor/links.ts`:** link queries over the tree (`linksIn(state, from, to)`, `enclosingLink(state, pos)`), each returning `{kind, from, to, textFrom, textTo, target, editable, hidden[]}`. Pure, tested like `syntax.ts`.
- **`src/editor/decorations.ts`:** adds link hiding, styling and widgets. Widgets implement `eq()`, so images aren't reloaded on every rebuild.
- **`src/editor/link-edits.ts`:** pure transaction specs for remove, rebuild and wrap-selection, plus the Backspace and Delete cases. Tested.
- **`src/editor/link-ui.ts`:** the toolbar (a CodeMirror tooltip), the click and hover handlers, and the paste handler. Obsidian access goes through a facet, as the callout menu does, so `decorations.ts` stays free of `obsidian`.
- **`src/main.ts`:** provides the facet (open, hover preview, resolve, resource paths), registers the `editor-menu` items, and adds Cmd+K and the Edit dialog.
- **Undocumented APIs**, if any are needed, go in `src/sidebar/internals.ts`, or an editor equivalent.

## Performance

- Decorations stay viewport-only, as now. 16,000 links means about a hundred on screen at once.
- Link resolution (resolved or not, resource paths) is cached per render pass, keyed by link text and source path.
- Image widgets compare by `src` and size in `eq()`, so scrolling and typing never reload images. Images use `loading="lazy"`.

## Risks

- **Caret motion around widgets with atomic ranges** is the hardest area. It needs explicit tests at every edge, plus a manual check in the app (Left/Right, Home/End, up/down through wrapped links).
- **Unconfirmed in Obsidian 1.13:** the `[[` suggester in Source mode, the exact `hover-link` payload, and that a `Prec.high` Cmd+K beats Obsidian's binding. Each is confirmed in the first slice that depends on it.
- **Links inside table cells** need `\|`. Tables aren't rendered yet, but writes must still be correct there.
- **Bare-URL detection:** GFM Autolink claims `https://x/[[y]]` entirely as a URL. That's acceptable.

## Out of scope

- Repairing `evernote:///` links (needs the importer to record Evernote IDs).
- Rendering embedded note content (a preview card is enough).
- `%%comments%%` and `$math$`.
- Link autocomplete beyond Obsidian's own.

## Slices, each useful alone

1. **Parser:** the `WikiLinks` extension and `readWiki`, with tests. Nothing visible changes yet.
2. **Rendering:** hide syntax for Markdown links, wikilinks, autolinks and bare URLs; style links, including unresolved and Evernote ones; Cmd+click opens. Links read cleanly from here on.
3. **Edit semantics:** edge typing, Backspace/Delete unlinking, selection rules, and atomic derived text.
4. **Link UI:** the toolbar, the Edit dialog, Cmd+K, right-click "Edit link…", pasting a URL over a selection, and Cmd+hover preview.
5. **Embeds:** image widgets with sizing, file chips, and note preview cards.
6. **Polish:** touch behaviour, keyboard access to the toolbar, and the review findings.
