# WYSIWYG v1 — Milestones 1+2 (Shell + Inline Marks) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development in-session) to implement this plan task-by-task.

**Goal:** An installable Obsidian plugin where bold/italic/inline-code delimiters are permanently hidden, formatting is toggled via Cmd/Ctrl+B/I/`, typed Markdown converts instantly, and Backspace at a boundary unformats instead of exposing syntax.

**Architecture:** Native CM6 editor extension registered via `registerEditorExtension()`. A `StateField` runs our own incremental `@lezer/markdown` parse (Obsidian's internal markdown parser has undocumented node names — we don't touch it). A `ViewPlugin` builds two decoration sets over the visible ranges: `hidden` (zero-width replace decorations over delimiter tokens, also fed to `EditorView.atomicRanges` so the caret skips them) and `decorations` (hidden + content styling marks). Commands and Backspace handling are pure functions `EditorState → TransactionSpec | null` with thin keymap wrappers, so everything except caret motion is unit-testable in Node without a DOM.

**Tech Stack:** TypeScript, esbuild, Vitest (node environment), `@codemirror/state|view|language` (external, provided by Obsidian), `@lezer/markdown` (bundled), `obsidian` types.

**Design doc:** `docs/plans/2026-07-13-wysiwyg-v1-design.md`

**Key insight — auto-convert is free.** Decorations derive from the parse tree with no cursor-proximity logic. The instant `**bold**` is complete, the tree contains `StrongEmphasis` and the delimiters vanish. No input rules needed.

**Conventions for all tasks:** Run tests with `npm test`. Commit after every green step with the exact message given. All source under `src/`, tests under `src/tests/`. Never use Obsidian API inside `src/editor/` — that directory must stay importable in Node tests.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `manifest.json`, `.gitignore`, `styles.css`, `src/main.ts` (stub)

**Step 1: Write the files**

`package.json`:
```json
{
  "name": "obsidian-wysiwyg-editor",
  "version": "0.1.0",
  "description": "True WYSIWYG Markdown editing for Obsidian",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@codemirror/language": "^6.10.0",
    "@codemirror/state": "6.5.0",
    "@codemirror/view": "6.38.6",
    "@lezer/common": "^1.2.0",
    "@lezer/markdown": "^1.3.0",
    "@types/node": "^22.0.0",
    "builtin-modules": "^4.0.0",
    "esbuild": "^0.25.0",
    "obsidian": "1.13.1",
    "tslib": "^2.8.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Note: `obsidian`, `@codemirror/state`, and `@codemirror/view` are pinned together (1.13.1 / 6.5.0 / 6.38.6) because obsidian@1.13.1 declares those exact versions as peer dependencies — floating ranges would eventually fail npm ERESOLVE; bump all three in lockstep.

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["DOM", "ES2020"],
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"]
}
```

`esbuild.config.mjs`:
```js
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```
Note: `@lezer/markdown` is deliberately **not** external — Obsidian doesn't provide it, we bundle it. `@lezer/common` **is** external so Tree/TreeFragment classes are shared with Obsidian's copy.

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
});
```

`manifest.json`:
```json
{
  "id": "wysiwyg-editor",
  "name": "WYSIWYG Editor",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "True WYSIWYG Markdown editing: syntax never shown, formatting via hotkeys, Markdown stays the file format.",
  "author": "Magnus",
  "isDesktopOnly": false
}
```

`.gitignore`:
```
node_modules/
main.js
*.map
.DS_Store
```

`styles.css`:
```css
.cm-wys-strong { font-weight: 700; }
.cm-wys-em { font-style: italic; }
.cm-wys-code {
  font-family: var(--font-monospace, monospace);
  background-color: var(--code-background, rgba(0, 0, 0, 0.06));
  border-radius: 3px;
  padding: 0 2px;
}
```

`src/main.ts` (stub, replaced in Task 8):
```ts
import { Plugin } from "obsidian";

export default class WysiwygPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("wysiwyg-editor loaded");
  }
}
```

**Step 2: Install and verify build**

Run: `npm install && npm run build`
Expected: tsc silent, esbuild writes `main.js` with no errors.

Run: `npm test`
Expected: "No test files found" — exits non-zero, that's fine for now (Task 2 adds the first test); anything other than "no test files" is a real failure.

**Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold Obsidian plugin (esbuild, vitest, manifest)"
```

---

### Task 2: Incremental Markdown parse StateField

**Files:**
- Create: `src/editor/parser.ts`
- Test: `src/tests/parser.test.ts`

**Step 1: Write the failing test**

`src/tests/parser.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree, treeOf } from "../editor/parser";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

function nodeNames(state: EditorState): string[] {
  const names: string[] = [];
  treeOf(state).iterate({
    enter(n) {
      names.push(n.name);
    },
  });
  return names;
}

describe("markdownTree", () => {
  test("parses strong emphasis on create", () => {
    const s = mkState("hello **world**");
    expect(nodeNames(s)).toContain("StrongEmphasis");
  });

  test("reparses incrementally on change", () => {
    const s = mkState("hello *world*");
    expect(nodeNames(s)).toContain("Emphasis");
    // turn *world* into **world**
    const tr = s.update({
      changes: [
        { from: 6, insert: "*" },
        { from: 13, insert: "*" },
      ],
    });
    expect(nodeNames(tr.state)).toContain("StrongEmphasis");
    expect(nodeNames(tr.state)).not.toContain("Emphasis");
  });

  test("tree length tracks document length", () => {
    const s = mkState("# heading\n\nsome text");
    expect(treeOf(s).length).toBe(s.doc.length);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../editor/parser`.

**Step 3: Write the implementation**

`src/editor/parser.ts` (uses `@codemirror/language`'s `DocInput` instead of a hand-rolled Input: it reads the Text rope zero-copy, and as an esbuild external provided by Obsidian it adds no bundle cost):
```ts
import { EditorState, StateField } from "@codemirror/state";
import { ChangedRange, Tree, TreeFragment } from "@lezer/common";
import { DocInput } from "@codemirror/language";
import { GFM, parser as baseParser } from "@lezer/markdown";

// Obsidian's own markdown parser has undocumented node names, so we run our
// own @lezer/markdown parse and never depend on Obsidian editor internals.
const parser = baseParser.configure([GFM]);

interface ParseState {
  tree: Tree;
  fragments: readonly TreeFragment[];
}

export const markdownTree = StateField.define<ParseState>({
  create(state) {
    const tree = parser.parse(new DocInput(state.doc));
    return { tree, fragments: TreeFragment.addTree(tree) };
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    const changes: ChangedRange[] = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) =>
      changes.push({ fromA, toA, fromB, toB })
    );
    let fragments = TreeFragment.applyChanges(value.fragments, changes);
    const tree = parser.parse(new DocInput(tr.newDoc), fragments);
    fragments = TreeFragment.addTree(tree, fragments);
    return { tree, fragments };
  },
});

export function treeOf(state: EditorState): Tree {
  return state.field(markdownTree).tree;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 3 passing.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: incremental @lezer/markdown parse as a StateField"
```

---

### Task 3: Inline mark extraction (`syntax.ts`)

**Files:**
- Create: `src/editor/syntax.ts`
- Test: `src/tests/syntax.test.ts`

**Step 1: Write the failing test**

`src/tests/syntax.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { inlineMarksIn } from "../editor/syntax";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

describe("inlineMarksIn", () => {
  test("finds strong emphasis with delimiter ranges", () => {
    const s = mkState("hello **world**");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks).toEqual([
      {
        type: "strong",
        from: 6,
        to: 15,
        delims: [
          { from: 6, to: 8 },
          { from: 13, to: 15 },
        ],
      },
    ]);
  });

  test("finds emphasis and inline code", () => {
    const s = mkState("*a* and `b`");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks.map((m) => m.type)).toEqual(["em", "code"]);
    expect(marks[1].delims).toEqual([
      { from: 8, to: 9 },
      { from: 10, to: 11 },
    ]);
  });

  test("handles nested strong inside emphasis", () => {
    const s = mkState("*a **b** c*");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks.map((m) => m.type).sort()).toEqual(["em", "strong"]);
  });

  test("respects the range filter", () => {
    const s = mkState("**a**\n\nplain\n\n**b**");
    const marks = inlineMarksIn(s, 6, 13);
    expect(marks).toEqual([]);
  });

  test("ignores unsupported syntax", () => {
    const s = mkState("~~strike~~ and | table | ish |");
    // strikethrough is out of scope for M2; nothing should be returned
    expect(inlineMarksIn(mkState("~~x~~"), 0, 5)).toEqual([]);
    expect(inlineMarksIn(s, 0, s.doc.length)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../editor/syntax`.

**Step 3: Write the implementation**

`src/editor/syntax.ts`:
```ts
import { EditorState } from "@codemirror/state";
import { treeOf } from "./parser";

export type InlineMarkType = "strong" | "em" | "code";

export interface TextSpan {
  from: number;
  to: number;
}

export interface InlineMark {
  type: InlineMarkType;
  from: number;
  to: number;
  delims: TextSpan[];
}

const CONTAINER_TYPES: Record<string, InlineMarkType> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
};

const DELIM_NAMES = new Set(["EmphasisMark", "CodeMark"]);

export function inlineMarksIn(
  state: EditorState,
  from: number,
  to: number
): InlineMark[] {
  const result: InlineMark[] = [];
  treeOf(state).iterate({
    from,
    to,
    enter(node) {
      const type = CONTAINER_TYPES[node.name];
      if (!type) return;
      if (node.from < from || node.to > to) return;
      const delims: TextSpan[] = [];
      for (const child of node.node.children ?? []) {
        // fall through to cursor-based scan below
      }
      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (DELIM_NAMES.has(cursor.name)) {
            delims.push({ from: cursor.from, to: cursor.to });
          }
        } while (cursor.nextSibling());
      }
      result.push({ type, from: node.from, to: node.to, delims });
    },
  });
  return result.sort((a, b) => a.from - b.from);
}
```
(If `node.node.children` doesn't exist on the API — it doesn't; that loop is dead scaffolding — delete it and keep only the cursor-based scan. Final code must not contain the dead loop.)

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing. If the nested test fails because `iterate` doesn't descend into `Emphasis` children after returning undefined, return `true`-equivalent by not short-circuiting: `enter` must not return `false` for container nodes.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: extract inline mark ranges from the syntax tree"
```

---

### Task 4: Decoration building (`decorations.ts`)

**Files:**
- Create: `src/editor/decorations.ts`
- Test: `src/tests/decorations.test.ts`

**Viewport-boundary constraint:** `inlineMarksIn` drops any construct that
straddles the query window, and inline marks can span newlines within a
paragraph. Task 5's per-visible-range calls therefore MUST expand each range
to whole-line/paragraph boundaries (e.g. `doc.lineAt(from).from` to
`doc.lineAt(to).to`) before querying, or delimiters will flash unhidden at
viewport edges.

**Step 1: Write the failing test**

`src/tests/decorations.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { EditorState, RangeSet } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { markdownTree } from "../editor/parser";
import { buildDecorations } from "../editor/decorations";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

function ranges(set: RangeSet<Decoration>): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  set.between(0, 1e9, (from, to, value) => {
    out.push([from, to, value.spec.class ?? "replace"]);
  });
  return out;
}

describe("buildDecorations", () => {
  test("hides strong delimiters and styles content", () => {
    const s = mkState("hello **world**");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [6, 8, "replace"],
      [13, 15, "replace"],
    ]);
    expect(ranges(decorations)).toContainEqual([6, 15, "cm-wys-strong"]);
  });

  test("styles inline code", () => {
    const s = mkState("run `ls` now");
    const { decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(decorations)).toContainEqual([4, 8, "cm-wys-code"]);
  });

  test("plain text produces no decorations", () => {
    const s = mkState("nothing fancy here");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([]);
    expect(ranges(decorations)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test` — FAIL, module missing.

**Step 3: Write the implementation**

`src/editor/decorations.ts`:
```ts
import { EditorState, Range as RangeValue, RangeSet } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { InlineMarkType, inlineMarksIn } from "./syntax";

const hideDelim = Decoration.replace({});

const contentMark: Record<InlineMarkType, Decoration> = {
  strong: Decoration.mark({ class: "cm-wys-strong" }),
  em: Decoration.mark({ class: "cm-wys-em" }),
  code: Decoration.mark({ class: "cm-wys-code" }),
};

export interface BuiltDecorations {
  /** Replace decorations over delimiter tokens — also used as atomic ranges. */
  hidden: DecorationSet;
  /** Everything the view should render: hidden delimiters + content styling. */
  decorations: DecorationSet;
}

export function buildDecorations(
  state: EditorState,
  from: number,
  to: number
): BuiltDecorations {
  const hidden: RangeValue<Decoration>[] = [];
  const all: RangeValue<Decoration>[] = [];
  for (const mark of inlineMarksIn(state, from, to)) {
    all.push(contentMark[mark.type].range(mark.from, mark.to));
    for (const d of mark.delims) {
      hidden.push(hideDelim.range(d.from, d.to));
      all.push(hideDelim.range(d.from, d.to));
    }
  }
  return {
    hidden: RangeSet.of(hidden, true),
    decorations: RangeSet.of(all, true),
  };
}
```

**Step 4: Run tests** — expect all passing. Watch out: `RangeSet.of(_, true)` sorts; mark decorations at the same `from` as replace decorations must not throw — if ordering errors appear, sort explicitly before constructing.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: build hide + styling decorations for inline marks"
```

---

### Task 5: View plugin and extension assembly (`extension.ts`)

**Files:**
- Create: `src/editor/extension.ts`
- Test: `src/tests/extension.test.ts` (state-level only; caret-motion is verified manually in Task 8)

**Step 1: Write the failing test**

`src/tests/extension.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { wysiwyg } from "../editor/extension";
import { markdownTree, treeOf } from "../editor/parser";

describe("wysiwyg extension bundle", () => {
  test("includes the markdown parse field exactly once", () => {
    const s = EditorState.create({ doc: "**x**", extensions: [wysiwyg()] });
    expect(treeOf(s).length).toBe(5);
  });

  test("is safe to combine with an explicit markdownTree", () => {
    const s = EditorState.create({
      doc: "ok",
      extensions: [wysiwyg(), markdownTree],
    });
    expect(treeOf(s).length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails** — module missing.

**Step 3: Write the implementation**

`src/editor/extension.ts`:
```ts
import { Extension, RangeSet } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { buildDecorations } from "./decorations";
import { markdownTree } from "./parser";
import { wysiwygKeymap } from "./edit-semantics";

class WysiwygView {
  decorations: DecorationSet = Decoration.none;
  hidden: DecorationSet = RangeSet.empty;

  constructor(view: EditorView) {
    this.compute(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.compute(update.view);
  }

  private compute(view: EditorView): void {
    const hidden = [];
    const decorations = [];
    // Build per visible range; RangeSet.join keeps it viewport-cheap.
    const parts = view.visibleRanges.map(({ from, to }) =>
      buildDecorations(view.state, from, to)
    );
    this.hidden = RangeSet.join(parts.map((p) => p.hidden));
    this.decorations = RangeSet.join(parts.map((p) => p.decorations));
  }
}

const decorationPlugin = ViewPlugin.fromClass(WysiwygView, {
  decorations: (v) => v.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of(
      (view) => view.plugin(plugin)?.hidden ?? RangeSet.empty
    ),
});

export function wysiwyg(): Extension {
  return [markdownTree, decorationPlugin, wysiwygKeymap];
}
```
Note: `edit-semantics.ts` doesn't exist yet. For this task create it as a placeholder exporting an empty keymap; Task 6–7 fill it in:
```ts
// src/editor/edit-semantics.ts (placeholder, completed in Task 7)
import { keymap } from "@codemirror/view";
export const wysiwygKeymap = keymap.of([]);
```

**Step 4: Run tests + build** — `npm test` all passing, `npm run build` clean (this is the first task that pulls `@codemirror/view` into the bundle graph).

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: viewport-aware decoration view plugin with atomic delimiter ranges"
```

---

### Task 6: Formatting commands (`commands.ts`)

**Files:**
- Create: `src/editor/commands.ts`
- Test: `src/tests/commands.test.ts`

Commands are pure: `toggleInlineSpec(state, type) → TransactionSpec | null`. Behavior:
- Selection (or word at cursor when selection is empty) not inside a `type` construct → wrap with delimiters (`**`, `*`, `` ` ``), selection maps to keep covering the content.
- Selection/cursor inside (or exactly covering) a `type` construct → delete both delimiter ranges (unformat).
- Empty selection not on a word and not inside a construct → return `null` (no-op; v1 has no "pending format" state).

**Step 1: Write the failing test**

`src/tests/commands.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { toggleInlineSpec } from "../editor/commands";

function mkState(doc: string, anchor: number, head?: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head ?? anchor),
    extensions: [markdownTree],
  });
}

function apply(state: EditorState, type: "strong" | "em" | "code"): string | null {
  const spec = toggleInlineSpec(state, type);
  if (!spec) return null;
  return state.update(spec).state.doc.toString();
}

describe("toggleInlineSpec", () => {
  test("wraps a selection in strong delimiters", () => {
    expect(apply(mkState("hello world", 6, 11), "strong")).toBe("hello **world**");
  });

  test("wraps the word at an empty cursor", () => {
    expect(apply(mkState("hello world", 8), "em")).toBe("hello *world*");
  });

  test("unwraps when the cursor is inside a construct", () => {
    expect(apply(mkState("hello **world**", 10), "strong")).toBe("hello world");
  });

  test("unwraps when the selection covers the content", () => {
    expect(apply(mkState("say `ls -la` ok", 5, 11), "code")).toBe("say ls -la ok");
  });

  test("no-op on empty cursor in whitespace", () => {
    expect(apply(mkState("a  b", 2), "strong")).toBeNull();
  });

  test("toggling em inside strong wraps, not unwraps", () => {
    expect(apply(mkState("**hello world**", 3, 8), "em")).toBe("***hello* world**");
  });
});
```

**Step 2: Run to verify failure** — module missing.

**Step 3: Write the implementation**

`src/editor/commands.ts`:
```ts
import {
  EditorSelection,
  EditorState,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { treeOf } from "./parser";
import { InlineMark, InlineMarkType, inlineMarksIn } from "./syntax";

const DELIM: Record<InlineMarkType, string> = {
  strong: "**",
  em: "*",
  code: "`",
};

/** Innermost mark of `type` whose full range contains [from, to]. */
function enclosingMark(
  state: EditorState,
  type: InlineMarkType,
  from: number,
  to: number
): InlineMark | null {
  const line = state.doc.lineAt(from);
  const lineEnd = state.doc.lineAt(to).to;
  const candidates = inlineMarksIn(state, line.from, lineEnd).filter(
    (m) => m.type === type && m.from <= from && m.to >= to
  );
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.from >= a.from ? b : a));
}

export function toggleInlineSpec(
  state: EditorState,
  type: InlineMarkType
): TransactionSpec | null {
  const sel = state.selection.main;
  let { from, to } = sel;

  const existing = enclosingMark(state, type, from, to);
  if (existing) {
    return {
      changes: existing.delims.map((d) => ({ from: d.from, to: d.to })),
      userEvent: "delete.format",
    };
  }

  if (sel.empty) {
    const word = state.wordAt(sel.head);
    if (!word) return null;
    from = word.from;
    to = word.to;
  }

  const d = DELIM[type];
  return {
    changes: [
      { from, insert: d },
      { from: to, insert: d },
    ],
    selection: EditorSelection.range(from + d.length, to + d.length),
    userEvent: "input.format",
  };
}

function run(type: InlineMarkType) {
  return (view: EditorView): boolean => {
    const spec = toggleInlineSpec(view.state, type);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}

export const toggleStrong = run("strong");
export const toggleEm = run("em");
export const toggleCode = run("code");
```

**Step 4: Run tests** — all passing. The nested-em test guards `enclosingMark` type filtering; the reduce picks the innermost candidate.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: toggle strong/em/code via pure transaction specs"
```

---

### Task 7: Backspace semantics (`edit-semantics.ts`)

**Files:**
- Modify: `src/editor/edit-semantics.ts` (replace placeholder)
- Test: `src/tests/edit-semantics.test.ts`

Behavior (pure `backspaceSpec(state) → TransactionSpec | null`, `null` = fall through to default Backspace):
1. Cursor immediately after a construct (i.e. right after its hidden closing delimiter) → remove both delimiters (unformat), keep content. Never delete a single `*` of a `**`.
2. Backspace that would delete the construct's **last content character** → delete the whole construct (content + delimiters), so orphaned delimiters like `****` never appear.
3. Anything else → `null`.

**Step 1: Write the failing test**

`src/tests/edit-semantics.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { backspaceSpec } from "../editor/edit-semantics";

function mkState(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdownTree],
  });
}

function apply(doc: string, cursor: number): string | null {
  const s = mkState(doc, cursor);
  const spec = backspaceSpec(s);
  if (!spec) return null;
  return s.update(spec).state.doc.toString();
}

describe("backspaceSpec", () => {
  test("backspace right after a strong span unformats it", () => {
    // "hi **bold**" cursor at end (11)
    expect(apply("hi **bold**", 11)).toBe("hi bold");
  });

  test("backspace right after inline code unformats it", () => {
    expect(apply("x `code`", 8)).toBe("x code");
  });

  test("backspace on last content char removes whole construct", () => {
    // "**b**" cursor after b (3)
    expect(apply("**b**", 3)).toBe("");
  });

  test("ordinary backspace inside content falls through", () => {
    expect(apply("**bold**", 5)).toBeNull();
  });

  test("plain text falls through", () => {
    expect(apply("hello", 5)).toBeNull();
  });

  test("start of document falls through", () => {
    expect(apply("**a**", 0)).toBeNull();
  });
});
```

**Step 2: Run to verify failure.**

**Step 3: Write the implementation**

`src/editor/edit-semantics.ts`:
```ts
import { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { InlineMark, inlineMarksIn } from "./syntax";

function marksAround(state: EditorState, pos: number): InlineMark[] {
  const line = state.doc.lineAt(pos);
  return inlineMarksIn(state, line.from, line.to);
}

export function backspaceSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty || sel.head === 0) return null;
  const head = sel.head;

  for (const mark of marksAround(state, head)) {
    const [open, close] = [mark.delims[0], mark.delims[mark.delims.length - 1]];
    if (!open || !close || mark.delims.length < 2) continue;

    // Case 1: cursor sits right after the closing delimiter → unformat.
    if (close.to === head) {
      return {
        changes: [
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ],
        userEvent: "delete.format",
      };
    }

    // Case 2: deleting the only content character → drop the whole construct.
    const contentFrom = open.to;
    const contentTo = close.from;
    if (head === contentTo && contentTo - contentFrom === 1) {
      return {
        changes: [{ from: mark.from, to: mark.to }],
        userEvent: "delete.format",
      };
    }
  }
  return null;
}

function runBackspace(view: EditorView): boolean {
  const spec = backspaceSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

export const wysiwygKeymap = Prec.high(
  keymap.of([{ key: "Backspace", run: runBackspace }])
);
```

**Step 4: Run tests** — all passing, plus the full suite stays green.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: backspace unformats at boundaries instead of exposing syntax"
```

---

### Task 8: Plugin shell — settings, toggle, hotkeys, debug command

**Files:**
- Modify: `src/main.ts` (replace stub)
- Create: `src/settings.ts`

No unit tests (Obsidian API is types-only); verified by build + manual smoke below.

**Step 1: Write the implementation**

`src/settings.ts`:
```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type WysiwygPlugin from "./main";

export interface WysiwygSettings {
  enabled: boolean;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
};

export class WysiwygSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WysiwygPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Enable WYSIWYG editing")
      .setDesc(
        "Hide Markdown syntax permanently and edit with hotkeys. Applies to all panes."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
```

`src/main.ts`:
```ts
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView, Plugin } from "obsidian";
import { toggleCode, toggleEm, toggleStrong } from "./editor/commands";
import { wysiwyg } from "./editor/extension";
import { treeOf } from "./editor/parser";
import { DEFAULT_SETTINGS, WysiwygSettings, WysiwygSettingTab } from "./settings";

export default class WysiwygPlugin extends Plugin {
  settings!: WysiwygSettings;
  private extensions: Extension[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.refreshExtensions();
    this.registerEditorExtension(this.extensions);
    this.addSettingTab(new WysiwygSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-wysiwyg",
      name: "Toggle WYSIWYG editing",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
      },
    });

    this.addCommand({
      id: "toggle-strong",
      name: "Toggle bold",
      hotkeys: [{ modifiers: ["Mod"], key: "b" }],
      editorCallback: (_editor, view) => this.withView(view, toggleStrong),
    });
    this.addCommand({
      id: "toggle-em",
      name: "Toggle italic",
      hotkeys: [{ modifiers: ["Mod"], key: "i" }],
      editorCallback: (_editor, view) => this.withView(view, toggleEm),
    });
    this.addCommand({
      id: "toggle-code",
      name: "Toggle inline code",
      hotkeys: [{ modifiers: ["Mod"], key: "`" }],
      editorCallback: (_editor, view) => this.withView(view, toggleCode),
    });

    this.addCommand({
      id: "dump-syntax-tree",
      name: "Debug: dump syntax tree",
      editorCallback: (_editor, view) => {
        this.withView(view, (cm) => {
          console.log(treeOf(cm.state).toString());
          return true;
        });
      },
    });
  }

  private withView(
    view: MarkdownView | unknown,
    fn: (cm: EditorView) => boolean
  ): void {
    // @ts-expect-error editor.cm is Obsidian's (stable, widely used) CM6 handle
    const cm: EditorView | undefined = (view as MarkdownView)?.editor?.cm;
    if (cm) fn(cm);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshExtensions();
  }

  private refreshExtensions(): void {
    this.extensions.length = 0;
    if (this.settings.enabled) this.extensions.push(wysiwyg());
    this.app.workspace.updateOptions();
  }
}
```

**Step 2: Build**

Run: `npm run build`
Expected: clean. If `editor.cm` typing complains differently than annotated, adjust the suppression but keep the runtime access — it's the standard community-plugin pattern.

**Step 3: Manual smoke test (dev vault)**

1. Create/choose a test vault; `mkdir -p <vault>/.obsidian/plugins/wysiwyg-editor` and copy `manifest.json`, `main.js`, `styles.css` into it (or symlink the repo folder).
2. Enable the plugin in Obsidian → Community plugins.
3. **Set the editor to Source mode** (per-pane: reading/editing toggle → Source mode). This is the intended dev configuration for M2 — our decorations do all rendering with no Live Preview interference. The Live Preview coexistence audit is Milestone 7.
4. Verify, in a note containing `plain **bold** *em* \`code\``:
   - Delimiters invisible; bold/italic/code styled.
   - Arrow keys: caret hops over hidden delimiters in one step, never lands "inside" them.
   - Type `**new**` — renders the instant the second `**` completes.
   - Cmd+B on a selection and on a bare word; Cmd+B again inside removes it.
   - Backspace at the end of a bold span unbolds; backspacing the last char inside removes the construct entirely; undo restores Markdown correctly.
   - Toggle the plugin setting off → raw Markdown returns immediately in open panes.
5. Third-party compatibility (with the Better Edit plugin enabled, if installed):
   - `/` slash menu opens and inserting e.g. Heading 1 / bullet / checkbox produces correctly rendered output.
   - Selecting text and using its inline toolbar's B/I buttons yields hidden-delimiter rendering.
   - Its strikethrough/highlight/math buttons produce visible plain Markdown (out of scope — must not crash or half-render).

**Step 4: Record results + commit**

Fix anything found (with a test where the layer allows), then:
```bash
git add -A && git commit -m "feat: plugin shell with settings toggle, hotkeys, and debug command"
```

---

## Out of scope for this plan (next plan docs)

- M3 headings, M4 lists/tasks, M5 blockquotes, M6 links/wikilinks (needs a small `@lezer/markdown` wikilink extension), M7 Live Preview suppression audit + paragraph polish.
- Selection-aware Delete (forward) semantics — mirror of Task 7, scheduled with M3.
- "Pending format" state (Cmd+B with no word then typing) — deliberate YAGNI for v1.
