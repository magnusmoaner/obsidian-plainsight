# Plainsight

An Obsidian plugin for a calm, document-like note experience. Markdown renders without its syntax while you edit, and ordinary Markdown files remain the source of truth. A two-column notes sidebar (notebooks, tags, tasks, note cards) is planned.

> **Status:** In development. Shipped: inline marks (bold, italic, code), headings, and callouts. Next: wikilinks, frontmatter, lists, and the sidebar. See `docs/plans/`.

## Goal

Build an Obsidian community plugin that makes Markdown feel like a rich-text document without replacing Obsidian's native editor or introducing a proprietary document format.

The intended experience is closer to Typora than to a separate Canvas-style editor:

* Markdown remains the canonical file format.
* Obsidian's native Markdown editor, file handling, undo/redo, links, embeds, and workspace integration remain available.
* Formatting syntax is visually minimized or hidden when it is not being edited.
* Syntax becomes visible around the cursor or active selection.
* Rendered elements remain editable and produce valid Markdown transactions.

## Initial scope

Start with a narrow vertical slice rather than attempting all of Markdown at once:

1. Headings
2. Strong and emphasis marks
3. Inline code
4. Links and wikilinks
5. Blockquotes
6. Unordered and ordered lists
7. Task checkboxes
8. Paragraph and line-break behavior

Defer initially:

* Tables
* Callouts
* Footnotes
* Mermaid and other code-block renderers
* Dataview syntax
* Complex embeds and transclusions
* Full rich-text paste handling
* Mobile-specific interaction polish

## Technical direction

Use Obsidian's public CodeMirror 6 integration:

```ts
this.registerEditorExtension(extension);
```

Likely building blocks:

* `@codemirror/language` for Markdown syntax-tree inspection.
* `@codemirror/state` for state fields and transactions.
* `@codemirror/view` for decorations, widgets, event handling, and view plugins.
* Obsidian's `Editor` API for operations that do not require direct CM6 access.
* Obsidian's `registerEditorExtension()` for plugin lifecycle management.

The first implementation should be a native editor extension, not a separate `ItemView` or `FileView`.

## Proposed architecture

```text
Obsidian plugin
    ├── settings and feature flags
    ├── editor extension registration
    ├── Markdown syntax-tree inspection
    ├── decoration/state management
    ├── cursor and selection awareness
    ├── rendered inline/block widgets
    └── safe Markdown transactions
```

### Rendering model

The underlying CodeMirror document remains Markdown. Decorations and widgets change its presentation without changing the stored file.

```text
Markdown source
    ↓
CodeMirror Markdown syntax tree
    ↓
WYSIWYG decorations/widgets
    ↓
User interaction
    ↓
CodeMirror transaction
    ↓
Markdown source
```

The extension must avoid mutating the document during ordinary rendering. Document changes should happen only through explicit user actions or editor transactions.

## Design principles

* **Markdown is the source of truth.** Never create a second proprietary document model unless a specific feature requires temporary state.
* **Progressive disclosure.** Hide syntax only when it is safe; reveal it when the cursor or selection enters the construct.
* **Native first.** Prefer public Obsidian and CodeMirror APIs over DOM patching or internal Obsidian classes.
* **Failure should be boring.** Unsupported or ambiguous syntax must remain visible and editable as normal Markdown.
* **No destructive parsing.** Preserve text that the plugin does not understand.
* **Small vertical slices.** Every feature should include rendering, cursor behavior, editing behavior, and regression tests.
* **Performance matters.** Decorations must be viewport-aware where appropriate and must not reparse the entire document on every keystroke without measurement.

## Suggested first milestones

### Milestone 1: Plugin shell

* Create a standard TypeScript Obsidian plugin.
* Register one CM6 extension.
* Add a setting to enable/disable the experimental WYSIWYG behavior.
* Add a debug command that reports the active Markdown syntax tree/document state.

### Milestone 2: Inline marks

* Render strong and emphasis text without visible delimiters when the cursor is outside the range.
* Reveal delimiters when the cursor enters the range.
* Preserve correct cursor positions and selection behavior.
* Add tests for nested and adjacent marks.

### Milestone 3: Block syntax

* Render headings, blockquotes, lists, and task checkboxes.
* Handle cursor transitions across block boundaries.
* Ensure keyboard editing remains predictable.

### Milestone 4: Links and embeds

* Render standard Markdown links and wikilinks.
* Preserve link destinations and aliases.
* Keep unsupported embed forms visible until their behavior is explicitly designed.

## Development notes

This repository is intended to be developed with Claude Code. Before implementing a feature, inspect the current project state and create a small implementation plan. Use test-driven development for parsing, range calculations, and transaction behavior. Verify builds and tests before claiming a feature is complete.

Recommended future files:

```text
manifest.json
package.json
tsconfig.json
esbuild.config.mjs
src/
    main.ts
    settings.ts
    editor/
        extension.ts
        decorations.ts
        cursor-awareness.ts
        transactions.ts
        syntax.ts
    tests/
```

## Useful references

* [Obsidian plugin documentation](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
* [Obsidian editor extensions](https://docs.obsidian.md/Plugins/Editor/Editor+extensions)
* [`registerEditorExtension()`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerEditorExtension)
* [Obsidian decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)
* [Obsidian state management](https://docs.obsidian.md/Plugins/Editor/State+management)
* [Obsidian communication with editor extensions](https://docs.obsidian.md/Plugins/Editor/Communicating+with+editor+extensions)
* [CodeMirror 6 documentation](https://codemirror.net/docs/)

## Open questions

* Should WYSIWYG mode be enabled globally, per vault, per note, or per editor pane?
* Should syntax be revealed on cursor entry, selection, keyboard navigation, or all three?
* How should live preview rendering interact with Obsidian's own Markdown decorations?
* Which constructs should use decorations, and which require replacement widgets?
* What is the minimum acceptable behavior on mobile?
* How should plugin-owned widgets behave when the document is changed externally?
