# Plainsight: working rules for Claude

Plainsight is an Obsidian plugin with two parts: a CodeMirror 6 editor extension that renders Markdown without showing its syntax (`src/editor/`), and a two-column notes sidebar (`src/sidebar/`). The plugin id is `plainsight`; the repo folder is still named `obsidian-wysiwyg-editor`.

## Keep README.md up to date

`README.md` is the public description of the plugin. **Any change visible to the user must update it in the same commit**, including:

- a feature added, removed or changed (editor constructs, sidebar places, card contents, menus, dialogs)
- a setting added, renamed, or with a changed default. Update the **Settings** table to match `src/settings.ts`.
- a command or shortcut. Update the **Shortcuts** table to match `src/editor/edit-semantics.ts` and the `addCommand` calls in `src/main.ts`.
- a change to how notes are written. Update **How Plainsight treats your notes**.
- a roadmap item started or finished. Update **Roadmap** and the status line.

Before finishing any feature, re-read the affected README sections against the code. Never describe something that isn't built, or describe it as finished when it isn't. Internal refactors with no user-visible effect don't need README changes.

## Workflow

- **Branch per feature**: `git checkout -b feature/<name>` from `main` before implementing. Merge only when Magnus says so.
- Before every commit, run `npx vitest run` and `npm run build` (strict `tsc`), and both must pass.
- To try a change in the vault, run `npm run deploy`, then Magnus reloads Obsidian (Cmd+R). Say clearly what has and hasn't been seen running in Obsidian.
- Prefer one adversarial review of a finished feature (finders, then independent refuters) over per-task review loops. Always do one for anything that writes to notes.

## Hard rules

- **Markdown files are the source of truth.** No parallel data store for note content.
- **Writes are minimal and line-based.** Change exactly the line(s) named: one task line, one frontmatter line, or a new file. Never re-serialize frontmatter (`processFrontMatter` drops comments and reformats YAML).
- **Recognise or refuse.** Text edits handle only shapes they positively understand (`src/sidebar/core/frontmatter.ts`, `edits.ts`, `pin.ts`). Anything else returns `null`, writes nothing, and the user gets an explanation. Invalid frontmatter makes Obsidian drop every property of the note.
- **Never write into a canvas.** `.canvas` files are JSON, and every edit here is line-based. Canvases get no tasks, no pin and no tags.
- **Never hide a note that has nowhere else to appear** (see `partition()` in `src/sidebar/view.ts`).
- **Never intercept other plugins' transactions.** Editor behaviour lives only in our own keymaps and commands.
- **Never reveal syntax** in the editor for supported constructs, including at the cursor.

## Code layout

- `src/sidebar/core/` is pure TypeScript and **must not import `obsidian`**, because tests run in Node. Put logic here, test-first.
- `src/sidebar/internals.ts` holds every undocumented Obsidian or plugin API (Bookmarks, Templates, Tasks `apiV1`, `vault.getConfig`). Read defensively, and degrade rather than throw.
- `src/editor/` runs its own incremental Lezer parse (`parser.ts`). It doesn't use Obsidian's parser, whose node names are undocumented.
- `docs/plans/` holds dated design docs (`YYYY-MM-DD-<topic>-design.md`) and implementation plans. They're historical records: don't rewrite old ones, add new ones.
