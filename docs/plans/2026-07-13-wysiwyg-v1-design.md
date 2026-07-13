# WYSIWYG v1 Design

Date: 2026-07-13
Status: Approved (brainstorm with Magnus, 2026-07-13)

## Problem

Obsidian's Live Preview is unsatisfying in three ways:

1. **Raw syntax editing** — the cursor entering a construct reveals `**`/`#` markers, and you edit Markdown by hand.
2. **Syntax jumping/reflow** — markers popping in and out makes text shift and dance.
3. **Clunky block UX** — weak list/checkbox ergonomics, awkward Enter/Backspace at block boundaries.

## Product decisions

- **Never reveal syntax.** Delimiters are permanently hidden. No cursor-proximity reveal. Formatting changes happen only through commands/hotkeys and widget interactions. Backspace at a boundary unformats; it never exposes markers.
- **Auto-convert while typing.** Typing `**bold**`, `# `, `- `, `> `, `[ ] ` converts instantly; markers vanish the moment a construct completes. Markdown muscle memory stays a valid input method.
- **v1 scope: the full README list** — headings, strong/emphasis, inline code, links/wikilinks, blockquotes, ordered/unordered lists, task checkboxes, paragraph/line-break behavior. Built as ordered milestones (inline marks first) so the hidden-delimiter model is proven before it spreads.
- **Global toggle.** One switch in settings plus a toggle command; applies to all Markdown panes. Per-pane/per-note can come later.
- **Boring failure.** Anything out of scope (tables, callouts, dataview, embeds beyond links) renders as plain visible Markdown and stays hand-editable.

## Architecture

Native CM6 editor extension via `registerEditorExtension()`. Markdown file remains the source of truth; the Lezer Markdown syntax tree is the only model. No parallel document model, no custom view.

Core mechanism: every delimiter token gets an **atomic replace decoration** (zero-width or widget), unconditionally. This removes the reveal state machine entirely and eliminates reflow by construction.

Three hard areas:

1. **Atomic ranges + cursor motion** — `EditorView.atomicRanges` makes the caret skip hidden delimiters so arrow keys feel rich-text native.
2. **Edit semantics at boundaries** — keymap/transaction filters give Backspace/Delete/Enter rich-text meaning at construct edges (unbold instead of exposing `**`; Enter in a list continues the list; Backspace on an empty list item outdents/exits).
3. **Input rules** — a transaction filter watches typed text and rewrites completed Markdown patterns.

While the toggle is on, the plugin suppresses/overrides the overlapping built-in Live Preview decorations so there is exactly one renderer per construct.

## Components

```
src/
  main.ts                  — plugin lifecycle, global toggle, registerEditorExtension()
  settings.ts              — settings tab: master switch, per-construct flags (debug aid)
  editor/
    extension.ts           — assembles the CM6 Extension array from enabled features
    syntax.ts              — syntax-tree queries (viewport-scoped range extraction)
    decorations.ts         — DecorationSet: hide delimiters, style content, widgets
    atomic.ts              — atomicRanges facet
    commands.ts            — Cmd+B/I/E, heading level, list toggle → transactions
    input-rules.ts         — auto-convert transaction filter
    edit-semantics.ts      — Backspace/Delete/Enter boundary behavior
  tests/
```

**Data flow per keystroke:** change → incremental Lezer reparse (viewport-aware) → syntax queries → decoration rebuild for changed/visible regions → render. No plugin-owned document state, so undo/redo and external file changes stay correct for free.

**Command flow:** hotkey → inspect tree at selection → minimal Markdown edit → one transaction → decoration cycle re-runs.

**Widgets vs. decorations:** checkboxes and list bullets are replacement widgets (checkbox click toggles `[ ]`↔`[x]` via transaction); everything else is styling marks plus hidden delimiters.

## Edit semantics (rules of thumb)

- Caret never lands inside a hidden delimiter (atomic ranges).
- Backspace/Delete adjacent to a construct boundary removes the *formatting* (both delimiters in one transaction), not one delimiter character.
- Enter inside a list item continues the list; Enter on an empty item outdents, then exits.
- Enter inside a heading/blockquote produces a plain paragraph below (heading) or continues the quote (quote); double-Enter exits the quote.
- Typing at the very edge of a formatted span goes *outside* the span by default (matching rich-text editors), with the caret-affinity nuance tested explicitly.
- Unknown/ambiguous syntax: no decoration, plain Markdown, never mutated.

## Third-party compatibility (hard requirements)

- **Never intercept foreign transactions.** Other plugins (e.g. Better Edit's slash commands and inline toolbar) format by inserting raw Markdown via editor transactions. Because our rendering derives purely from the parse tree, their output renders correctly the moment it lands. To keep this true, our behavior changes live only in our own keymap bindings and commands — no global `transactionFilter` that rewrites or blocks edits from other sources.
- **Better Edit** must keep working: `/`-command insertion (headings, lists, checkbox, quote) and selection-toolbar wrapping both flow through the mechanism above. Buttons producing out-of-scope syntax (strikethrough `~~`, highlight `==`, math `$`) fall back to visible plain Markdown. Verify in every milestone's smoke test.
- **Tasks plugin notation** (M4): the checkbox widget renders from the actual status character and supports custom statuses (`[/]`, `[-]`, etc. — render them; toggle only cycles `[ ]`↔`[x]`). Toggling rewrites the status character only. Emoji metadata (`📅`, `🔁`, `⏫`, `🆔`) is ordinary text content — rendered as-is, never parsed, never mutated.

## Testing

- Vitest with CM6 `EditorState`/`EditorView` in jsdom — CodeMirror is testable headlessly.
- TDD for: syntax range extraction, input-rule conversions, command transactions, boundary edit semantics. Each construct lands with tests for nested/adjacent/edge cases before styling polish.
- Manual smoke testing in a dev vault via `esbuild` watch build.

## Milestones (within v1)

1. **Shell** — plugin scaffold, settings, global toggle, debug command dumping the syntax tree.
2. **Inline marks** — bold/italic/inline-code: hiding, atomic caret motion, Cmd+B/I/E, auto-convert, boundary semantics. *Proves the whole model.*
3. **Headings** — `# ` conversion, level styling, Cmd+1..6, Enter behavior.
4. **Lists & tasks** — bullets/numbers as widgets, checkbox toggle, Enter/Backspace/Tab list ergonomics.
5. **Blockquotes** — bar rendering, continuation/exit semantics.
6. **Links & wikilinks** — render text/alias, hide targets, click-to-follow vs. click-to-edit affordance, Cmd+K.
7. **Paragraph/line-break polish + Live Preview suppression audit.**
