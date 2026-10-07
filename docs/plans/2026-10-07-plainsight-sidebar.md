# Plainsight Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Obsidian's File explorer with a two-column, Evernote-11-style sidebar: places on the left (Shortcuts, Notes, Tasks, Templates, Notebooks, Tags), note cards or task rows on the right.

**Architecture:** A pure TypeScript core (`src/sidebar/core/`) turns note text and metadata into `NoteSummary` records held in a `NoteIndex`, and answers "what's in this place" with plain query functions. The core is tested in node with vitest, like the editor. A thin Obsidian layer (`src/sidebar/*.ts`) feeds the index from vault events, renders one `ItemView` with two columns, and performs the only writes: toggle a task, pin, create a note. Design: `docs/plans/2026-10-07-plainsight-sidebar-design.md`.

**Tech Stack:** TypeScript, Obsidian plugin API (`ItemView`, `metadataCache`, `vault`, `fileManager`, `Menu`), vitest (node environment), esbuild.

---

## Ground rules for the implementer

- **Never import `obsidian` from `src/sidebar/core/`.** Vitest runs in node, and `obsidian` doesn't exist there. Everything in `core/` must be plain TS.
- Tests live in `src/tests/sidebar/` (vitest includes `src/tests/**/*.test.ts`).
- Run one test file with `npx vitest run src/tests/sidebar/<file>.test.ts` and the whole suite with `npx vitest run`. The baseline is 99 passing tests and must never drop.
- `npm run build` runs `tsc -noEmit` (strict) and then esbuild. It must pass before every commit that touches `src/sidebar/*.ts`.
- `npm run deploy` builds and copies into the vault (`.obsidian/plugins/plainsight`). Magnus reloads Obsidian with Cmd+R.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Write-safety rule:** a write changes exactly what its task names (one task line, one frontmatter key, or a new file) and nothing else. Tasks-plugin emoji metadata (📅 🔁 ⏫ 🆔 …) must pass through untouched.

---

### Task 1: Core types

**Files:**
- Create: `src/sidebar/core/types.ts`

**Step 1: Write the types**

```ts
/** A Markdown task line, as found in a note. */
export interface TaskItem {
  /** 0-based line number in the note. */
  line: number;
  /** The character between the brackets: " ", "x", "/", "-", … */
  status: string;
  /** Everything after `[ ] `, including any Tasks-plugin fields. */
  text: string;
  /** YYYY-MM-DD from the Tasks plugin's 📅 field, if present. */
  due: string | null;
}

/** Everything the sidebar needs to know about one note. */
export interface NoteSummary {
  path: string;
  title: string;
  /** Parent folder path; "" for the vault root. */
  folder: string;
  /** Tags without the leading "#", de-duplicated. */
  tags: string[];
  pinned: boolean;
  mtime: number;
  ctime: number;
  snippet: string;
  tasks: TaskItem[];
  /** Link target of the first embedded image, unresolved. */
  thumbnail: string | null;
  /** Lower-cased title, tags and body for search, capped in length. */
  searchText: string;
}

/** Done or cancelled — no longer an open task. */
export function isClosed(task: TaskItem): boolean {
  return task.status === "x" || task.status === "X" || task.status === "-";
}

/** True if `folder` is `root` or lies beneath it. "" is the vault root. */
export function inFolder(folder: string, root: string): boolean {
  return root === "" || folder === root || folder.startsWith(`${root}/`);
}
```

**Step 2: Build**

Run: `npm run build`
Expected: passes, with no output after the esbuild line.

**Step 3: Commit**

```bash
git add src/sidebar/core/types.ts
git commit -m "feat(sidebar): core types"
```

---

### Task 2: Snippet extraction

The card snippet is the "first useful text" of a note: no frontmatter, no headings (the title already says it), no fence or table noise, and no Markdown syntax.

**Files:**
- Create: `src/sidebar/core/snippet.ts`
- Test: `src/tests/sidebar/snippet.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { extractSnippet } from "../../sidebar/core/snippet";

describe("extractSnippet", () => {
  test("skips frontmatter and headings", () => {
    const text = "---\ntags: [a]\n---\n# Title\n\nFirst real line.";
    expect(extractSnippet(text)).toBe("First real line.");
  });

  test("joins short lines until the length budget", () => {
    expect(extractSnippet("one\ntwo\nthree")).toBe("one two three");
  });

  test("truncates with an ellipsis", () => {
    const s = extractSnippet("word ".repeat(100), 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith("…")).toBe(true);
  });

  test("strips inline syntax and resolves link text", () => {
    expect(
      extractSnippet("See **bold**, *em*, `code`, ==hi==, [[Note]] and [[Target|alias]].")
    ).toBe("See bold, em, code, hi, Note and alias.");
  });

  test("drops the heading part of a wikilink", () => {
    expect(extractSnippet("Go to [[Note#Section]] now")).toBe("Go to Note now");
  });

  test("keeps markdown link text, drops embeds and images", () => {
    expect(extractSnippet("![[pic.png]] a [site](https://x.dk) ![alt](i.png) b")).toBe(
      "a site b"
    );
  });

  test("strips callout tokens and quote markers but keeps the text", () => {
    expect(extractSnippet("> [!info] Heads up\n> body text")).toBe("Heads up body text");
  });

  test("strips list and task markers", () => {
    expect(extractSnippet("- [ ] Buy milk\n1. Step one")).toBe("Buy milk Step one");
  });

  test("skips fenced code contents, rules and tables", () => {
    const text = "```\ncode()\n```\n---\n| a | b |\nAfter.";
    expect(extractSnippet(text)).toBe("After.");
  });

  test("empty and syntax-only notes give an empty snippet", () => {
    expect(extractSnippet("")).toBe("");
    expect(extractSnippet("---\na: 1\n---\n# Only a heading")).toBe("");
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/snippet.test.ts`
Expected: FAIL — cannot resolve `../../sidebar/core/snippet`.

**Step 3: Write the implementation**

```ts
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The note's first useful text, for a card. Lines are cleaned of Markdown
 * and joined until `max` characters, then truncated with an ellipsis.
 */
export function extractSnippet(text: string, max = 160): string {
  const body = text.replace(FRONTMATTER, "");
  const parts: string[] = [];
  let length = 0;
  let inFence = false;
  for (const raw of body.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = cleanLine(raw);
    if (!line) continue;
    parts.push(line);
    length += line.length + 1;
    if (length >= max) break;
  }
  const joined = parts.join(" ");
  if (joined.length <= max) return joined;
  return `${joined.slice(0, max - 1).trimEnd()}…`;
}

function cleanLine(raw: string): string {
  let line = raw.trim();
  if (!line) return "";
  if (/^#{1,6}\s/.test(line)) return ""; // the card title already says it
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return ""; // horizontal rule
  if (/^\|.*\|$/.test(line)) return ""; // table row
  line = line
    .replace(/^(>\s*)+/, "") // quote / callout prefix
    .replace(/^\[![^\]]+\][+-]?\s*/, "") // callout token, keep its title
    .replace(/^([-*+]|\d+[.)])\s+(\[.\]\s+)?/, "") // list and task markers
    .replace(/!\[\[[^\]]*\]\]/g, "") // embeds
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // aliased wikilink → alias
    .replace(/\[\[([^\]|#]*)(?:#[^\]]*)?\]\]/g, "$1") // wikilink → target
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown link → text
    .replace(/(\*\*|__|==|~~|`)/g, "") // paired inline marks
    .replace(/(^|\s)[*_](?=\S)/g, "$1") // opening single * or _
    .replace(/(\S)[*_](?=[\s.,;:!?)]|$)/g, "$1") // closing single * or _
    .replace(/<[^>]+>/g, "") // inline HTML
    .replace(/\s+/g, " ")
    .trim();
  return line;
}
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/snippet.test.ts`
Expected: PASS (10 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/snippet.ts src/tests/sidebar/snippet.test.ts
git commit -m "feat(sidebar): snippet extraction"
```

---

### Task 3: Task parsing and the fallback toggle

The Tasks plugin is the authority on toggling (done dates, recurrence). `toggleTaskLine` is only the fallback used when the Tasks API isn't available (Task 12). It flips `[ ]` to `[x]`; `x`/`X` goes back to `[ ]`; any other status becomes `[x]`.

**Files:**
- Create: `src/sidebar/core/tasks.ts`
- Test: `src/tests/sidebar/tasks.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { parseTasks, taskDisplayText, toggleTaskLine } from "../../sidebar/core/tasks";

describe("parseTasks", () => {
  test("finds tasks with line numbers and statuses", () => {
    const text = "intro\n- [ ] open\n- [x] done\n* [/] doing";
    expect(parseTasks(text)).toEqual([
      { line: 1, status: " ", text: "open", due: null },
      { line: 2, status: "x", text: "done", due: null },
      { line: 3, status: "/", text: "doing", due: null },
    ]);
  });

  test("reads the Tasks plugin due date", () => {
    const [task] = parseTasks("- [ ] Pay bill 📅 2026-10-09 ⏫");
    expect(task.due).toBe("2026-10-09");
    expect(task.text).toBe("Pay bill 📅 2026-10-09 ⏫");
  });

  test("handles indented and numbered tasks", () => {
    expect(parseTasks("  - [ ] nested\n1. [ ] numbered").map((t) => t.text)).toEqual([
      "nested",
      "numbered",
    ]);
  });

  test("ignores tasks inside fenced code and plain list items", () => {
    expect(parseTasks("```\n- [ ] not real\n```\n- plain item")).toEqual([]);
  });

  test("tolerates CRLF line endings", () => {
    expect(parseTasks("- [ ] a\r\n- [x] b")).toHaveLength(2);
  });
});

describe("taskDisplayText", () => {
  test("cuts at the first Tasks-plugin field", () => {
    expect(taskDisplayText("Pay bill 📅 2026-10-09 🔁 every month")).toBe("Pay bill");
  });

  test("leaves plain text alone", () => {
    expect(taskDisplayText("Call the school")).toBe("Call the school");
  });
});

describe("toggleTaskLine", () => {
  test("open becomes done, keeping indentation and metadata", () => {
    expect(toggleTaskLine("  - [ ] Pay 📅 2026-10-09")).toBe("  - [x] Pay 📅 2026-10-09");
  });

  test("done becomes open", () => {
    expect(toggleTaskLine("- [x] Pay")).toBe("- [ ] Pay");
    expect(toggleTaskLine("- [X] Pay")).toBe("- [ ] Pay");
  });

  test("a custom status becomes done", () => {
    expect(toggleTaskLine("- [/] Doing")).toBe("- [x] Doing");
  });

  test("preserves a trailing carriage return", () => {
    expect(toggleTaskLine("- [ ] a\r")).toBe("- [x] a\r");
  });

  test("returns null for a line that is not a task", () => {
    expect(toggleTaskLine("- just a list item")).toBeNull();
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/tasks.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```ts
import { TaskItem } from "./types";

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s?)(.*)$/;
const DUE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const FENCE = /^\s*(```|~~~)/;
// Tasks-plugin field markers. They always follow the description, so the
// text before the first one is the human-readable task.
const TASKS_FIELD = /[📅⏳🛫✅➕❌🔁⏫🔼🔽⏬🔺🆔⛔]/u;

export function parseTasks(text: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = TASK_LINE.exec(line);
    if (!match) return;
    tasks.push({
      line: index,
      status: match[2],
      text: match[4].trim(),
      due: DUE.exec(match[4])?.[1] ?? null,
    });
  });
  return tasks;
}

export function taskDisplayText(text: string): string {
  return text.split(TASKS_FIELD)[0].trim();
}

/**
 * Fallback toggle when the Tasks plugin API is unavailable. Changes only
 * the status character; returns null if `line` is not a task.
 */
export function toggleTaskLine(line: string): string | null {
  const cr = line.endsWith("\r") ? "\r" : "";
  const body = cr ? line.slice(0, -1) : line;
  const match = TASK_LINE.exec(body);
  if (!match) return null;
  const next = match[2] === "x" || match[2] === "X" ? " " : "x";
  return `${match[1]}${next}${match[3]}${match[4]}${cr}`;
}
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/tasks.test.ts`
Expected: PASS (12 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/tasks.ts src/tests/sidebar/tasks.test.ts
git commit -m "feat(sidebar): task parsing and fallback toggle"
```

---

### Task 4: Note summary (thumbnail + summarize)

**Files:**
- Create: `src/sidebar/core/summary.ts`
- Test: `src/tests/sidebar/summary.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { FileFacts, firstImage, summarize } from "../../sidebar/core/summary";

const facts = (over: Partial<FileFacts> = {}): FileFacts => ({
  path: "Inbox/Note.md",
  basename: "Note",
  folder: "Inbox",
  mtime: 2000,
  ctime: 1000,
  tags: [],
  frontmatter: undefined,
  ...over,
});

describe("firstImage", () => {
  test("finds a wikilink image embed, ignoring size and heading", () => {
    expect(firstImage("text ![[scan.jpg|300]] more")).toBe("scan.jpg");
  });

  test("finds a markdown image", () => {
    expect(firstImage("![alt](Attachments/My%20pic.png)")).toBe("Attachments/My pic.png");
  });

  test("skips non-image embeds", () => {
    expect(firstImage("![[Other note]] ![[doc.pdf]] ![[pic.webp]]")).toBe("pic.webp");
  });

  test("null when there is no image", () => {
    expect(firstImage("plain")).toBeNull();
  });
});

describe("summarize", () => {
  test("builds a complete summary", () => {
    const s = summarize(
      facts({ tags: ["#Work", "#work", "#a/b"], frontmatter: { pinned: true } }),
      "---\npinned: true\n---\nHello world\n- [ ] one\n- [x] two\n![[p.png]]"
    );
    expect(s).toMatchObject({
      path: "Inbox/Note.md",
      title: "Note",
      folder: "Inbox",
      tags: ["Work", "a/b"],
      pinned: true,
      mtime: 2000,
      ctime: 1000,
      thumbnail: "p.png",
    });
    expect(s.snippet).toBe("Hello world one two");
    expect(s.tasks).toHaveLength(2);
    expect(s.searchText).toContain("note");
    expect(s.searchText).toContain("hello world");
  });

  test("pinned only for true or 'true'", () => {
    expect(summarize(facts({ frontmatter: { pinned: "true" } }), "").pinned).toBe(true);
    expect(summarize(facts({ frontmatter: { pinned: "yes" } }), "").pinned).toBe(false);
    expect(summarize(facts(), "").pinned).toBe(false);
  });
});
```

Note: tags de-duplicate case-insensitively, keeping the first spelling ("Work"), because Obsidian treats tags as case-insensitive.

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/summary.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```ts
import { extractSnippet } from "./snippet";
import { parseTasks } from "./tasks";
import { NoteSummary } from "./types";

/** What the Obsidian layer knows about a file without reading it. */
export interface FileFacts {
  path: string;
  basename: string;
  folder: string;
  mtime: number;
  ctime: number;
  /** As returned by getAllTags: with "#", possibly repeated. */
  tags: string[];
  frontmatter: Record<string, unknown> | undefined;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const EMBED = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const SEARCH_CAP = 20000;

export function firstImage(text: string): string | null {
  for (const match of text.matchAll(EMBED)) {
    const target = (match[1] ?? safeDecode(match[2])).trim();
    if (IMAGE.test(target)) return target;
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.replace(/^#/, "");
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()];
}

export function summarize(facts: FileFacts, text: string): NoteSummary {
  const tags = normalizeTags(facts.tags);
  const pinned = facts.frontmatter?.pinned;
  return {
    path: facts.path,
    title: facts.basename,
    folder: facts.folder,
    tags,
    pinned: pinned === true || pinned === "true",
    mtime: facts.mtime,
    ctime: facts.ctime,
    snippet: extractSnippet(text),
    tasks: parseTasks(text),
    thumbnail: firstImage(text),
    searchText: `${facts.basename} ${tags.join(" ")} ${text.slice(0, SEARCH_CAP)}`.toLowerCase(),
  };
}
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/summary.test.ts`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/summary.ts src/tests/sidebar/summary.test.ts
git commit -m "feat(sidebar): note summaries"
```

---

### Task 5: NoteIndex

**Files:**
- Create: `src/sidebar/core/note-index.ts`
- Test: `src/tests/sidebar/note-index.test.ts`

**Step 1: Create the shared test fixture**

Later test files reuse this helper, so it lives outside any `*.test.ts` file (vitest only collects `*.test.ts`). Create `src/tests/sidebar/fixtures.ts`:

```ts
import { NoteSummary } from "../../sidebar/core/types";

/** A NoteSummary with sensible defaults; override any field. */
export function note(path: string, over: Partial<NoteSummary> = {}): NoteSummary {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return {
    path,
    title: path.split("/").pop()!.replace(/\.md$/, ""),
    folder,
    tags: [],
    pinned: false,
    mtime: 0,
    ctime: 0,
    snippet: "",
    tasks: [],
    thumbnail: null,
    searchText: path.toLowerCase(),
    ...over,
  };
}
```

**Step 1b: Write the failing tests**

```ts
import { describe, expect, test, vi } from "vitest";
import { NoteIndex } from "../../sidebar/core/note-index";
import { note } from "./fixtures";

describe("NoteIndex", () => {
  test("set, get, all and size", () => {
    const index = new NoteIndex();
    index.set(note("a.md"));
    index.set(note("b.md"));
    expect(index.size).toBe(2);
    expect(index.get("a.md")?.title).toBe("a");
    expect(index.all().map((n) => n.path).sort()).toEqual(["a.md", "b.md"]);
  });

  test("set replaces an existing entry", () => {
    const index = new NoteIndex();
    index.set(note("a.md", { snippet: "old" }));
    index.set(note("a.md", { snippet: "new" }));
    expect(index.size).toBe(1);
    expect(index.get("a.md")?.snippet).toBe("new");
  });

  test("delete and deleteUnder", () => {
    const index = new NoteIndex();
    index.replaceAll([note("x/a.md"), note("x/y/b.md"), note("z.md")]);
    index.delete("z.md");
    index.deleteUnder("x");
    expect(index.size).toBe(0);
  });

  test("notifies subscribers on change, not on no-op deletes", () => {
    const index = new NoteIndex();
    const fn = vi.fn();
    const unsubscribe = index.subscribe(fn);
    index.set(note("a.md"));
    index.delete("missing.md");
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
    index.set(note("b.md"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/note-index.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```ts
import { inFolder, NoteSummary } from "./types";

/** All note summaries, keyed by path, with change notification. */
export class NoteIndex {
  private notes = new Map<string, NoteSummary>();
  private listeners = new Set<() => void>();

  get size(): number {
    return this.notes.size;
  }

  get(path: string): NoteSummary | undefined {
    return this.notes.get(path);
  }

  all(): NoteSummary[] {
    return [...this.notes.values()];
  }

  set(summary: NoteSummary): void {
    this.notes.set(summary.path, summary);
    this.emit();
  }

  delete(path: string): void {
    if (this.notes.delete(path)) this.emit();
  }

  /** Remove every note at or beneath `folder` (a deleted or renamed folder). */
  deleteUnder(folder: string): void {
    let changed = false;
    for (const summary of this.notes.values()) {
      if (inFolder(summary.folder, folder)) changed = this.notes.delete(summary.path) || changed;
    }
    if (changed) this.emit();
  }

  replaceAll(summaries: NoteSummary[]): void {
    this.notes = new Map(summaries.map((s) => [s.path, s]));
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/note-index.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/note-index.ts src/tests/sidebar/note-index.test.ts src/tests/sidebar/fixtures.ts
git commit -m "feat(sidebar): note index"
```

---

### Task 6: Note queries, sorting and grouping

**Files:**
- Create: `src/sidebar/core/queries.ts`
- Test: `src/tests/sidebar/queries.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { groupNotes, notesFor } from "../../sidebar/core/queries";
import { note } from "./fixtures";

const OCT = Date.UTC(2026, 9, 15);
const SEP = Date.UTC(2026, 8, 15);
const opts = { sort: "modified" as const, search: "", templatesFolder: "Templates" };

const notes = [
  note("Inbox/a.md", { mtime: SEP, tags: ["Work"] }),
  note("Inbox/Sub/b.md", { mtime: OCT, tags: ["work/client"] }),
  note("Other/c.md", { mtime: OCT - 1, pinned: true }),
  note("Templates/t.md", { mtime: OCT + 1 }),
];
const paths = (list: { path: string }[]) => list.map((n) => n.path);

describe("notesFor", () => {
  test("Notes = everything except templates; pinned first, then newest", () => {
    expect(paths(notesFor(notes, { kind: "notes" }, opts))).toEqual([
      "Other/c.md",
      "Inbox/Sub/b.md",
      "Inbox/a.md",
    ]);
  });

  test("a notebook includes its subfolders", () => {
    expect(paths(notesFor(notes, { kind: "notebook", folder: "Inbox" }, opts))).toEqual([
      "Inbox/Sub/b.md",
      "Inbox/a.md",
    ]);
  });

  test("a tag matches nested tags, case-insensitively", () => {
    expect(paths(notesFor(notes, { kind: "tag", tag: "work" }, opts))).toEqual([
      "Inbox/Sub/b.md",
      "Inbox/a.md",
    ]);
  });

  test("templates place lists only the templates folder", () => {
    expect(paths(notesFor(notes, { kind: "templates" }, opts))).toEqual(["Templates/t.md"]);
    expect(notesFor(notes, { kind: "templates" }, { ...opts, templatesFolder: null })).toEqual([]);
  });

  test("search requires every term", () => {
    const list = [
      note("x.md", { searchText: "budget plan 2026" }),
      note("y.md", { searchText: "budget only" }),
    ];
    expect(paths(notesFor(list, { kind: "notes" }, { ...opts, search: "Plan budget" }))).toEqual([
      "x.md",
    ]);
  });

  test("title sort is alphabetical with numbers in order", () => {
    const list = [note("n10.md"), note("n2.md"), note("a.md")];
    expect(paths(notesFor(list, { kind: "notes" }, { ...opts, sort: "title" }))).toEqual([
      "a.md",
      "n2.md",
      "n10.md",
    ]);
  });
});

describe("groupNotes", () => {
  test("pinned group first, then months", () => {
    const sorted = notesFor(notes, { kind: "notes" }, opts);
    expect(groupNotes(sorted, "modified").map((g) => [g.label, g.notes.length])).toEqual([
      ["Pinned Notes", 1],
      ["October 2026", 1],
      ["September 2026", 1],
    ]);
  });

  test("title sort has no month groups", () => {
    const list = [note("a.md"), note("b.md")];
    expect(groupNotes(list, "title").map((g) => g.label)).toEqual([""]);
  });

  test("no notes, no groups", () => {
    expect(groupNotes([], "modified")).toEqual([]);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/queries.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```ts
import { inFolder, NoteSummary } from "./types";

export type Place =
  | { kind: "notes" }
  | { kind: "notebook"; folder: string }
  | { kind: "tag"; tag: string }
  | { kind: "tasks" }
  | { kind: "templates" };

export type SortKey = "modified" | "created" | "title";

export interface QueryOptions {
  sort: SortKey;
  search: string;
  templatesFolder: string | null;
}

export interface NoteGroup {
  label: string;
  notes: NoteSummary[];
}

function inPlace(note: NoteSummary, place: Place, templates: string | null): boolean {
  const isTemplate = templates !== null && inFolder(note.folder, templates);
  switch (place.kind) {
    case "notes":
      return !isTemplate;
    case "notebook":
      return inFolder(note.folder, place.folder);
    case "tag": {
      const tag = place.tag.toLowerCase();
      return note.tags.some((t) => {
        const lower = t.toLowerCase();
        return lower === tag || lower.startsWith(`${tag}/`);
      });
    }
    case "templates":
      return isTemplate;
    case "tasks":
      return note.tasks.length > 0;
  }
}

function matchesSearch(note: NoteSummary, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => note.searchText.includes(term));
}

const byTitle = (a: NoteSummary, b: NoteSummary) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

function comparator(sort: SortKey) {
  return (a: NoteSummary, b: NoteSummary): number => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "title") return byTitle(a, b);
    const key = sort === "created" ? "ctime" : "mtime";
    return b[key] - a[key] || byTitle(a, b);
  };
}

export function notesFor(notes: NoteSummary[], place: Place, opts: QueryOptions): NoteSummary[] {
  return notes
    .filter((n) => inPlace(n, place, opts.templatesFolder) && matchesSearch(n, opts.search))
    .sort(comparator(opts.sort));
}

/** Pinned notes first, then (for date sorts) one group per month. */
export function groupNotes(sorted: NoteSummary[], sort: SortKey): NoteGroup[] {
  const groups: NoteGroup[] = [];
  const pinned = sorted.filter((n) => n.pinned);
  const rest = sorted.filter((n) => !n.pinned);
  if (pinned.length) groups.push({ label: "Pinned Notes", notes: pinned });
  if (!rest.length) return groups;
  if (sort === "title") {
    groups.push({ label: "", notes: rest });
    return groups;
  }
  let current: NoteGroup | null = null;
  for (const n of rest) {
    const label = new Date(sort === "created" ? n.ctime : n.mtime).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (!current || current.label !== label) {
      current = { label, notes: [] };
      groups.push(current);
    }
    current.notes.push(n);
  }
  return groups;
}
```

Test dates are mid-month in UTC, so the month labels don't depend on the machine's timezone.

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/queries.test.ts`
Expected: PASS (9 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/queries.ts src/tests/sidebar/queries.test.ts
git commit -m "feat(sidebar): note queries, sorting and month groups"
```

---

### Task 7: Notebook and tag trees

Both nav sections are indented trees with counts, so they share one builder. A parent's count includes its descendants, and each note counts once per node. Folders with no notes are hidden: an attachments folder isn't a notebook.

**Files:**
- Modify: `src/sidebar/core/queries.ts` (append)
- Modify: `src/tests/sidebar/queries.test.ts` (append)

**Step 1: Write the failing tests**

```ts
import { folderRows, tagRows } from "../../sidebar/core/queries";

describe("folderRows", () => {
  const list = [note("A/x.md"), note("A/B/y.md"), note("A B/z.md"), note("root.md")];

  test("indented tree, parents before children, counts include descendants", () => {
    expect(folderRows(["A", "A/B", "A B", "Attachments"], list, null)).toEqual([
      { path: "A", name: "A", depth: 0, count: 2 },
      { path: "A/B", name: "B", depth: 1, count: 1 },
      { path: "A B", name: "A B", depth: 0, count: 1 },
    ]);
  });

  test("excludes the templates folder", () => {
    expect(folderRows(["A", "Templates"], [note("Templates/t.md")], "Templates")).toEqual([]);
  });
});

describe("tagRows", () => {
  test("nested tags with ancestor counts, each note counted once", () => {
    const list = [
      note("1.md", { tags: ["work/client", "work"] }),
      note("2.md", { tags: ["Work/internal"] }),
      note("3.md", { tags: ["home"] }),
    ];
    expect(tagRows(list)).toEqual([
      { path: "home", name: "home", depth: 0, count: 1 },
      { path: "work", name: "work", depth: 0, count: 2 },
      { path: "work/client", name: "client", depth: 1, count: 1 },
      { path: "work/internal", name: "internal", depth: 1, count: 1 },
    ]);
  });
});
```

The tree must order "A" → "A/B" → "A B" by walking parent-to-children. Sorting full path strings would interleave "A B" between "A" and "A/B", because ICU collation largely ignores punctuation. Tag paths are lower-cased so `Work/internal` and `work/client` share one parent.

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/queries.test.ts`
Expected: FAIL — `folderRows` is not exported.

**Step 3: Write the implementation (append to `queries.ts`)**

```ts
export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  count: number;
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Depth-first rows from a path → count map, children sorted by name. */
function treeRows(counts: Map<string, number>): TreeRow[] {
  const children = new Map<string, string[]>();
  for (const path of counts.keys()) {
    const parent = parentOf(path);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(path);
  }
  const rows: TreeRow[] = [];
  const walk = (parent: string, depth: number) => {
    const kids = (children.get(parent) ?? []).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
    for (const path of kids) {
      rows.push({ path, name: path.slice(path.lastIndexOf("/") + 1), depth, count: counts.get(path)! });
      walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

export function folderRows(
  folders: string[],
  notes: NoteSummary[],
  templatesFolder: string | null
): TreeRow[] {
  const counts = new Map<string, number>();
  for (const folder of folders) {
    if (!folder || (templatesFolder && inFolder(folder, templatesFolder))) continue;
    const count = notes.filter((n) => inFolder(n.folder, folder)).length;
    if (count > 0) counts.set(folder, count);
  }
  // A parent dropped as empty would orphan its children; keep any ancestor of a kept folder.
  for (const folder of [...counts.keys()]) {
    for (let p = parentOf(folder); p; p = parentOf(p)) {
      if (!counts.has(p)) counts.set(p, notes.filter((n) => inFolder(n.folder, p)).length);
    }
  }
  return treeRows(counts);
}

export function tagRows(notes: NoteSummary[]): TreeRow[] {
  const members = new Map<string, Set<string>>();
  for (const n of notes) {
    for (const tag of n.tags) {
      const parts = tag.toLowerCase().split("/");
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join("/");
        if (!members.has(path)) members.set(path, new Set());
        members.get(path)!.add(n.path);
      }
    }
  }
  return treeRows(new Map([...members].map(([path, set]) => [path, set.size])));
}
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/queries.test.ts`
Expected: PASS (12 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/queries.ts src/tests/sidebar/queries.test.ts
git commit -m "feat(sidebar): notebook and tag trees"
```

---

### Task 8: Task rows

**Files:**
- Modify: `src/sidebar/core/queries.ts` (append)
- Modify: `src/tests/sidebar/queries.test.ts` (append)

**Step 1: Write the failing tests**

```ts
import { taskRows } from "../../sidebar/core/queries";

describe("taskRows", () => {
  const t = (line: number, status: string, due: string | null = null) => ({
    line,
    status,
    text: `task ${line}`,
    due,
  });
  const list = [
    note("a.md", { mtime: 1, tasks: [t(0, " ", "2026-10-20"), t(1, "x"), t(2, " ")] }),
    note("b.md", { mtime: 2, tasks: [t(0, " ", "2026-10-01"), t(1, "-")] }),
  ];
  const keys = (rows: { note: { path: string }; task: { line: number } }[]) =>
    rows.map((r) => `${r.note.path}:${r.task.line}`);

  test("open: earliest due first, undated last", () => {
    expect(keys(taskRows(list, "open", "2026-10-07"))).toEqual(["b.md:0", "a.md:0", "a.md:2"]);
  });

  test("overdue: open with a due date before today", () => {
    expect(keys(taskRows(list, "overdue", "2026-10-07"))).toEqual(["b.md:0"]);
  });

  test("done includes cancelled, newest note first", () => {
    expect(keys(taskRows(list, "done", "2026-10-07"))).toEqual(["b.md:1", "a.md:1"]);
  });

  test("progress counts closed over total", () => {
    // Exercised by the card; covered here via isClosed semantics.
    expect(list[0].tasks.filter((x) => x.status !== " ").length).toBe(1);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/queries.test.ts`
Expected: FAIL — `taskRows` is not exported.

**Step 3: Write the implementation (append to `queries.ts`)**

Add `isClosed` and `TaskItem` to the existing import from `./types`, then:

```ts
export type TaskFilter = "open" | "overdue" | "done";

export interface TaskRow {
  note: NoteSummary;
  task: TaskItem;
}

/** `today` is a local YYYY-MM-DD string, so comparison is plain string order. */
export function taskRows(notes: NoteSummary[], filter: TaskFilter, today: string): TaskRow[] {
  const rows = notes.flatMap((note) => note.tasks.map((task) => ({ note, task })));
  const keep = rows.filter(({ task }) => {
    if (filter === "done") return isClosed(task);
    if (isClosed(task)) return false;
    return filter === "open" || (task.due !== null && task.due < today);
  });
  return keep.sort((a, b) => {
    if (filter !== "done") {
      const dueA = a.task.due ?? "9999-99-99";
      const dueB = b.task.due ?? "9999-99-99";
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    }
    return b.note.mtime - a.note.mtime || a.task.line - b.task.line;
  });
}

export function taskProgress(note: NoteSummary): { closed: number; total: number } {
  return { closed: note.tasks.filter(isClosed).length, total: note.tasks.length };
}
```

Then replace the placeholder "progress" test with a real one:

```ts
import { taskProgress } from "../../sidebar/core/queries";

test("taskProgress counts done and cancelled as closed", () => {
  expect(taskProgress(list[1])).toEqual({ closed: 1, total: 2 });
});
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/queries.test.ts`
Expected: PASS (16 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/queries.ts src/tests/sidebar/queries.test.ts
git commit -m "feat(sidebar): task rows and progress"
```

---

### Task 9: Card dates and template expansion

**Files:**
- Create: `src/sidebar/core/format.ts`
- Test: `src/tests/sidebar/format.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { applyTemplate, cardDate, localISODate } from "../../sidebar/core/format";

describe("cardDate", () => {
  const now = new Date(2026, 9, 7, 12, 0).getTime();
  test("relative within a day", () => {
    expect(cardDate(now - 20_000, now)).toBe("just now");
    expect(cardDate(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(cardDate(now - 60_000, now)).toBe("1 minute ago");
    expect(cardDate(now - 3 * 3_600_000, now)).toBe("3 hours ago");
  });
  test("month and day this year, with the year otherwise", () => {
    expect(cardDate(new Date(2026, 9, 5).getTime(), now)).toBe("Oct 5");
    expect(cardDate(new Date(2025, 2, 1).getTime(), now)).toBe("Mar 1, 2025");
  });
});

describe("localISODate", () => {
  test("formats in local time", () => {
    expect(localISODate(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("applyTemplate", () => {
  const fmt = (f: string) => `<${f}>`;
  test("title, date, time and custom formats", () => {
    expect(
      applyTemplate("# {{title}}\n{{date}} {{time}} {{date:dddd}}", "Note", fmt, "YYYY-MM-DD", "HH:mm")
    ).toBe("# Note\n<YYYY-MM-DD> <HH:mm> <dddd>");
  });
  test("leaves unknown placeholders alone", () => {
    expect(applyTemplate("{{other}}", "x", fmt, "D", "T")).toBe("{{other}}");
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/sidebar/format.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function cardDate(time: number, now: number = Date.now()): string {
  const diff = now - time;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = new Date(time);
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

export function localISODate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Core Templates placeholders: {{title}}, {{date}}, {{time}}, {{date:FMT}},
 * {{time:FMT}}. `format` is injected (moment in the app) to keep this pure.
 */
export function applyTemplate(
  text: string,
  title: string,
  format: (pattern: string) => string,
  dateFormat: string,
  timeFormat: string
): string {
  return text.replace(/\{\{(title|date|time)(?::([^}]+))?\}\}/g, (_, key: string, custom?: string) => {
    if (key === "title") return title;
    return format(custom ?? (key === "date" ? dateFormat : timeFormat));
  });
}
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/sidebar/format.test.ts`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add src/sidebar/core/format.ts src/tests/sidebar/format.test.ts
git commit -m "feat(sidebar): card dates and template expansion"
```

---

### Task 10: Obsidian internals adapter

Everything undocumented goes in one file, read defensively. If a shape changes, the feature degrades (a section hides, or the fallback toggle runs) instead of throwing.

**Files:**
- Create: `src/sidebar/internals.ts`

**Step 1: Write the adapter**

```ts
import { App, normalizePath } from "obsidian";

/**
 * Undocumented Obsidian/plugin APIs, isolated so they're easy to audit.
 * Every accessor returns null when the shape isn't what we expect.
 */

export interface Shortcut {
  kind: "file" | "folder" | "search";
  title: string;
  target: string;
}

type Loose = Record<string, unknown> | null | undefined;

function internalPlugin(app: App, id: string): Loose {
  const plugins = (app as unknown as { internalPlugins?: { getPluginById?(id: string): Loose } })
    .internalPlugins;
  const plugin = plugins?.getPluginById?.(id) as { enabled?: boolean; instance?: Loose } | null;
  return plugin?.enabled ? plugin.instance : null;
}

const lastSegment = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

export function readShortcuts(app: App): Shortcut[] | null {
  const items = internalPlugin(app, "bookmarks")?.items;
  if (!Array.isArray(items)) return null;
  const out: Shortcut[] = [];
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      const item = raw as Record<string, unknown>;
      const title = typeof item.title === "string" && item.title ? item.title : null;
      if (item.type === "group" && Array.isArray(item.items)) walk(item.items);
      else if (item.type === "file" && typeof item.path === "string")
        out.push({ kind: "file", target: item.path, title: title ?? lastSegment(item.path) });
      else if (item.type === "folder" && typeof item.path === "string")
        out.push({ kind: "folder", target: item.path, title: title ?? lastSegment(item.path) });
      else if (item.type === "search" && typeof item.query === "string")
        out.push({ kind: "search", target: item.query, title: title ?? item.query });
    }
  };
  walk(items);
  return out;
}

export interface TemplateOptions {
  folder: string | null;
  dateFormat: string;
  timeFormat: string;
}

export function templateOptions(app: App): TemplateOptions {
  const options = internalPlugin(app, "templates")?.options as Record<string, unknown> | undefined;
  const folder = typeof options?.folder === "string" && options.folder.trim() ? options.folder : null;
  return {
    folder: folder ? normalizePath(folder) : null,
    dateFormat: typeof options?.dateFormat === "string" && options.dateFormat ? options.dateFormat : "YYYY-MM-DD",
    timeFormat: typeof options?.timeFormat === "string" && options.timeFormat ? options.timeFormat : "HH:mm",
  };
}

export function openGlobalSearch(app: App, query: string): boolean {
  const search = internalPlugin(app, "global-search") as { openGlobalSearch?(q: string): void } | null;
  if (typeof search?.openGlobalSearch !== "function") return false;
  search.openGlobalSearch(query);
  return true;
}

export function openSettingsTab(app: App, tabId: string): void {
  const setting = (app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
  setting?.open();
  setting?.openTabById(tabId);
}

/**
 * Toggle through the Tasks plugin so done dates and recurrence follow its
 * rules. Returns the replacement text (may span several lines for recurring
 * tasks), or null when the API is unavailable.
 */
export function tasksToggle(app: App, line: string, path: string): string | null {
  const api = (app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: Loose }> } }).plugins
    ?.plugins?.["obsidian-tasks-plugin"]?.apiV1 as
    | { executeToggleTaskDoneCommand?(line: string, path: string): string }
    | undefined;
  if (typeof api?.executeToggleTaskDoneCommand !== "function") return null;
  return api.executeToggleTaskDoneCommand(line, path);
}
```

**Step 2: Build**

Run: `npm run build`
Expected: passes.

**Step 3: Commit**

```bash
git add src/sidebar/internals.ts
git commit -m "feat(sidebar): isolated adapter for undocumented Obsidian APIs"
```

---

### Task 11: Indexer (vault → index)

**Files:**
- Create: `src/sidebar/indexer.ts`

**Step 1: Write the indexer**

```ts
import { App, EventRef, getAllTags, TAbstractFile, TFile, TFolder } from "obsidian";
import { NoteIndex } from "./core/note-index";
import { summarize } from "./core/summary";

/** Keeps a NoteIndex in step with the vault. */
export class Indexer {
  constructor(private app: App, private index: NoteIndex) {}

  async build(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    this.index.replaceAll(await Promise.all(files.map((f) => this.summarizeFile(f))));
  }

  /** Call once, inside onLayoutReady, after build(). */
  start(register: (ref: EventRef) => void): void {
    const { vault, metadataCache } = this.app;
    // 'changed' carries the new text, so no extra read is needed.
    register(
      metadataCache.on("changed", (file, data) => {
        if (file.extension === "md") this.index.set(this.fromText(file, data));
      })
    );
    register(vault.on("create", (file) => void this.upsert(file)));
    register(
      vault.on("delete", (file) => {
        if (file instanceof TFile) this.index.delete(file.path);
        else if (file instanceof TFolder) this.index.deleteUnder(file.path);
      })
    );
    register(
      vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.index.delete(oldPath);
          void this.upsert(file);
        } else if (file instanceof TFolder) {
          this.index.deleteUnder(oldPath);
          for (const f of this.app.vault.getMarkdownFiles()) {
            if (f.path.startsWith(`${file.path}/`)) void this.upsert(f);
          }
        }
      })
    );
  }

  /** Every folder path in the vault, "" excluded. */
  folders(): string[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
      .map((f) => f.path);
  }

  private async upsert(file: TAbstractFile): Promise<void> {
    if (file instanceof TFile && file.extension === "md") this.index.set(await this.summarizeFile(file));
  }

  private async summarizeFile(file: TFile) {
    return this.fromText(file, await this.app.vault.cachedRead(file));
  }

  private fromText(file: TFile, text: string) {
    const cache = this.app.metadataCache.getFileCache(file);
    const parent = file.parent;
    return summarize(
      {
        path: file.path,
        basename: file.basename,
        folder: !parent || parent.isRoot() ? "" : parent.path,
        mtime: file.stat.mtime,
        ctime: file.stat.ctime,
        tags: cache ? getAllTags(cache) ?? [] : [],
        frontmatter: cache?.frontmatter,
      },
      text
    );
  }
}
```

On first launch some files have no metadata cache yet, so their tags are briefly empty. The `changed` event corrects them once Obsidian indexes the file. That's acceptable; don't add polling.

**Step 2: Build**

Run: `npm run build`
Expected: passes.

**Step 3: Commit**

```bash
git add src/sidebar/indexer.ts
git commit -m "feat(sidebar): incremental indexer over vault events"
```

---

### Task 12: Write actions

All the sidebar's writes, in one file, each obeying the write-safety rule.

**Files:**
- Create: `src/sidebar/actions.ts`

**Step 1: Write the actions**

```ts
import { App, moment, Notice, normalizePath, PaneType, TFile, WorkspaceLeaf } from "obsidian";
import { applyTemplate } from "./core/format";
import { toggleTaskLine } from "./core/tasks";
import { templateOptions, tasksToggle } from "./internals";

/**
 * Toggle the task on `lineNo`, but only if that line still holds the task we
 * rendered (`expectedText`). If the note changed underneath us, do nothing
 * rather than tick the wrong line.
 */
export async function toggleTask(app: App, path: string, lineNo: number, expectedText: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  let stale = false;
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const line = lines[lineNo];
    if (line === undefined || !line.replace(/\r$/, "").trimEnd().endsWith(expectedText)) {
      stale = true;
      return data;
    }
    const cr = line.endsWith("\r") ? "\r" : "";
    const viaTasks = tasksToggle(app, line.replace(/\r$/, ""), path);
    const next = viaTasks !== null ? viaTasks.split("\n").map((l) => l + cr).join("\n") : toggleTaskLine(line);
    if (next === null || next === line) return data;
    lines[lineNo] = next;
    return lines.join("\n");
  });
  if (stale) new Notice("That note changed — the task list has been refreshed.");
}

export async function togglePin(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (fm.pinned === true || fm.pinned === "true") delete fm.pinned;
    else fm.pinned = true;
  });
}

function availablePath(app: App, folder: string, base: string): string {
  for (let n = 0; ; n++) {
    const name = n ? `${base} ${n}` : base;
    const path = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}

/** Create a note in `folder` (null = Obsidian's default location) and open it. */
export async function createNote(app: App, folder: string | null, template?: TFile): Promise<void> {
  const target = folder ?? app.fileManager.getNewFileParent("").path;
  const path = availablePath(app, target === "/" ? "" : target, "Untitled");
  const title = path.split("/").pop()!.replace(/\.md$/, "");
  let text = "";
  if (template) {
    const opts = templateOptions(app);
    text = applyTemplate(
      await app.vault.cachedRead(template),
      title,
      (pattern) => moment().format(pattern),
      opts.dateFormat,
      opts.timeFormat
    );
  }
  const file = await app.vault.create(path, text);
  await openFile(app, file, false);
}

/** `mode` is Keymap.isModEvent(evt) for clicks: false = current tab, true/"tab" = new tab, "split"/"window" as named. */
export async function openFile(
  app: App,
  file: TFile,
  mode: PaneType | boolean,
  line?: number
): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.getLeaf(mode);
  await leaf.openFile(file, line === undefined ? undefined : { eState: { line } });
  return leaf;
}
```

The `expectedText` check compares the end of the line with the task text the row was rendered from (the parsed text, trimmed). Pass `row.task.text`.

**Step 2: Build**

Run: `npm run build`
Expected: passes.

**Step 3: Commit**

```bash
git add src/sidebar/actions.ts
git commit -m "feat(sidebar): task toggle, pin and note creation"
```

---

### Task 13: Settings and view registration

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Create: `src/sidebar/view.ts` (a stub, filled in Tasks 14–16)

**Step 1: Add settings**

In `src/settings.ts`, extend the interface and defaults:

```ts
export interface WysiwygSettings {
  enabled: boolean;
  takeOverRendering: boolean;
  /** Show the Plainsight notes sidebar. */
  sidebar: boolean;
  /** Width of the sidebar's nav column, in px. */
  sidebarNavWidth: number;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
  takeOverRendering: false,
  sidebar: true,
  sidebarNavWidth: 200,
};
```

Add a toggle at the end of `display()`:

```ts
    new Setting(this.containerEl)
      .setName("Notes sidebar")
      .setDesc(
        "A two-column sidebar: places (shortcuts, notes, tasks, templates, notebooks, tags) " +
          "and note cards. Turn off the core File explorer to use it in its place."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebar).onChange(async (value) => {
          this.plugin.settings.sidebar = value;
          await this.plugin.saveSettings();
        })
      );
```

**Step 2: Create the view stub**

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type WysiwygPlugin from "../main";

export const SIDEBAR_VIEW = "plainsight-sidebar";

export class SidebarView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: WysiwygPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return "Notes";
  }

  getIcon(): string {
    return "notebook";
  }

  async onOpen(): Promise<void> {
    this.contentEl.setText(`Plainsight: ${this.plugin.index.size} notes`);
  }
}
```

**Step 3: Wire it into the plugin**

In `src/main.ts`:

```ts
import { WorkspaceLeaf } from "obsidian"; // add to the existing obsidian import
import { NoteIndex } from "./sidebar/core/note-index";
import { Indexer } from "./sidebar/indexer";
import { SIDEBAR_VIEW, SidebarView } from "./sidebar/view";
```

Class fields:

```ts
  readonly index = new NoteIndex();
  indexer!: Indexer;
```

At the end of `onload()`:

```ts
    this.indexer = new Indexer(this.app, this.index);
    this.registerView(SIDEBAR_VIEW, (leaf: WorkspaceLeaf) => new SidebarView(leaf, this));
    this.addCommand({
      id: "open-sidebar",
      name: "Open notes sidebar",
      callback: () => void this.openSidebar(),
    });
    this.app.workspace.onLayoutReady(async () => {
      await this.indexer.build();
      this.indexer.start((ref) => this.registerEvent(ref));
      if (this.settings.sidebar) await this.openSidebar();
    });
```

New methods:

```ts
  async openSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
    if (!leaf) {
      const left = workspace.getLeftLeaf(false);
      if (!left) return;
      await left.setViewState({ type: SIDEBAR_VIEW, active: true });
      leaf = left;
    }
    await workspace.revealLeaf(leaf);
  }

  private applySidebarSetting(): void {
    if (!this.settings.sidebar) this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW);
    else if (this.app.workspace.layoutReady) void this.openSidebar();
  }
```

Call `this.applySidebarSetting();` at the end of `saveSettings()`.

**Step 4: Build, test, deploy, look**

Run: `npm run build && npx vitest run && npm run deploy`
Expected: build passes; all tests pass (99 + the new sidebar tests); deployed.
Manual: Cmd+R in Obsidian. A "Notes" tab appears in the left sidebar showing "Plainsight: 791 notes" (or close to it).

**Step 5: Commit**

```bash
git add src/settings.ts src/main.ts src/sidebar/view.ts
git commit -m "feat(sidebar): register view, settings toggle, index on layout ready"
```

---

### Task 14: View skeleton: two columns, divider, nav

**Files:**
- Modify: `src/sidebar/view.ts` (replace the stub entirely)

**Step 1: Write the view with nav rendering**

```ts
import { ItemView, Keymap, Menu, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type WysiwygPlugin from "../main";
import { cardDate, localISODate } from "./core/format";
import {
  folderRows,
  groupNotes,
  notesFor,
  Place,
  SortKey,
  tagRows,
  TaskFilter,
  taskProgress,
  taskRows,
  TreeRow,
} from "./core/queries";
import { taskDisplayText } from "./core/tasks";
import { isClosed, NoteSummary } from "./core/types";
import { createNote, openFile, toggleTask, togglePin } from "./actions";
import { openGlobalSearch, openSettingsTab, readShortcuts, templateOptions } from "./internals";

export const SIDEBAR_VIEW = "plainsight-sidebar";
const BATCH = 100;

export class SidebarView extends ItemView {
  private place: Place = { kind: "notes" };
  private sort: SortKey = "modified";
  private search = "";
  private taskFilter: TaskFilter = "open";
  /** Mobile shows one column at a time. */
  private mobilePane: "nav" | "list" = "nav";

  private navEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private filtersEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private observers: IntersectionObserver[] = [];
  private renderTimer: number | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WysiwygPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return "Notes";
  }

  getIcon(): string {
    return "notebook";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ps-sidebar");
    root.toggleClass("is-mobile", Platform.isMobile);
    root.style.setProperty("--ps-nav-width", `${this.plugin.settings.sidebarNavWidth}px`);

    this.navEl = root.createDiv("ps-nav");
    const divider = root.createDiv("ps-divider");
    const list = root.createDiv("ps-list");
    this.headerEl = list.createDiv("ps-list-header");
    // Built once: re-creating the input on every render would steal focus mid-typing.
    const search = list.createEl("input", { cls: "ps-search", type: "search", placeholder: "Search" });
    search.addEventListener("input", () => {
      this.search = search.value;
      this.renderList();
    });
    this.filtersEl = list.createDiv("ps-filters");
    this.bodyEl = list.createDiv("ps-list-body");

    this.makeResizable(divider);
    this.unsubscribe = this.plugin.index.subscribe(() => this.queueRender());
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.disconnectObservers();
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  /** Index changes arrive in bursts (folder renames, startup); coalesce them. */
  private queueRender(): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 150);
  }

  private render(): void {
    this.contentEl.toggleClass("show-list", this.mobilePane === "list");
    this.renderNav();
    this.renderList();
  }

  private setPlace(place: Place): void {
    this.place = place;
    this.mobilePane = "list";
    this.render();
  }

  private isActive(place: Place): boolean {
    return JSON.stringify(place) === JSON.stringify(this.place);
  }

  // ---------- nav column ----------

  private renderNav(): void {
    const nav = this.navEl;
    nav.empty();
    const notes = this.plugin.index.all();
    const templates = templateOptions(this.app).folder;

    const newNote = nav.createDiv("ps-new-note");
    setIcon(newNote.createSpan(), "file-plus-2");
    newNote.createSpan({ text: "Note" });
    newNote.addEventListener("click", () => void createNote(this.app, this.currentFolder()));

    const shortcuts = readShortcuts(this.app);
    if (shortcuts) {
      this.navHeading(nav, "Shortcuts", "star");
      for (const s of shortcuts) {
        const icon = s.kind === "folder" ? "folder" : s.kind === "search" ? "search" : "file-text";
        const row = this.navRow(nav, s.title, icon, 1, null, false);
        row.addEventListener("click", (evt) => this.openShortcut(s.kind, s.target, evt));
      }
    }

    const noteCount = notesFor(notes, { kind: "notes" }, this.queryOptions("")).length;
    const openTasks = notes.reduce((n, note) => n + note.tasks.filter((t) => !isClosed(t)).length, 0);
    this.placeRow(nav, "Notes", "file-text", { kind: "notes" }, 0, noteCount);
    this.placeRow(nav, "Tasks", "check-circle-2", { kind: "tasks" }, 0, openTasks);
    const templateCount = templates
      ? notesFor(notes, { kind: "templates" }, this.queryOptions("")).length
      : null;
    this.placeRow(nav, "Templates", "layout-template", { kind: "templates" }, 0, templateCount);

    this.navHeading(nav, "Notebooks", "book");
    this.treeSection(nav, folderRows(this.plugin.indexer.folders(), notes, templates), (row) => ({
      kind: "notebook",
      folder: row.path,
    }));

    const tags = tagRows(notes);
    if (tags.length) {
      this.navHeading(nav, "Tags", "tag");
      this.treeSection(nav, tags, (row) => ({ kind: "tag", tag: row.path }));
    }
  }

  private navHeading(parent: HTMLElement, label: string, icon: string): void {
    const el = parent.createDiv("ps-nav-heading");
    setIcon(el.createSpan("ps-nav-icon"), icon);
    el.createSpan({ text: label });
  }

  private navRow(
    parent: HTMLElement,
    label: string,
    icon: string | null,
    depth: number,
    count: number | null,
    active: boolean
  ): HTMLElement {
    const row = parent.createDiv("ps-nav-item");
    row.style.setProperty("--ps-depth", String(depth));
    row.toggleClass("is-active", active);
    const iconEl = row.createSpan("ps-nav-icon");
    if (icon) setIcon(iconEl, icon);
    row.createSpan({ cls: "ps-nav-label", text: label });
    if (count !== null) row.createSpan({ cls: "ps-nav-count", text: String(count) });
    return row;
  }

  private placeRow(
    parent: HTMLElement,
    label: string,
    icon: string | null,
    place: Place,
    depth: number,
    count: number | null
  ): void {
    const row = this.navRow(parent, label, icon, depth, count, this.isActive(place));
    row.addEventListener("click", () => this.setPlace(place));
  }

  private treeSection(parent: HTMLElement, rows: TreeRow[], toPlace: (row: TreeRow) => Place): void {
    // Tree rows are indented without icons.
    for (const row of rows) this.placeRow(parent, row.name, null, toPlace(row), row.depth + 1, row.count);
  }

  private openShortcut(kind: "file" | "folder" | "search", target: string, evt: MouseEvent): void {
    if (kind === "folder") return this.setPlace({ kind: "notebook", folder: target });
    if (kind === "search") {
      openGlobalSearch(this.app, target);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(target);
    if (file instanceof TFile) void openFile(this.app, file, Keymap.isModEvent(evt));
  }

  private currentFolder(): string | null {
    return this.place.kind === "notebook" ? this.place.folder : null;
  }

  private queryOptions(search = this.search) {
    return { sort: this.sort, search, templatesFolder: templateOptions(this.app).folder };
  }

  // ---------- divider ----------

  private makeResizable(divider: HTMLElement): void {
    divider.addEventListener("mousedown", (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startWidth = this.navEl.getBoundingClientRect().width;
      const move = (evt: MouseEvent) => {
        const width = Math.min(360, Math.max(140, startWidth + evt.clientX - startX));
        this.contentEl.style.setProperty("--ps-nav-width", `${width}px`);
        this.plugin.settings.sidebarNavWidth = Math.round(width);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        void this.plugin.saveData(this.plugin.settings);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  // ---------- list column (Tasks 15–16) ----------

  private renderList(): void {
    this.headerEl.empty();
    this.bodyEl.empty();
  }

  private markActive(): void {}

  private disconnectObservers(): void {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
  }
}
```

Note for the implementer:
- Saving the width uses `saveData` directly rather than `saveSettings`, because `saveSettings` reconfigures every editor and re-applies the rendering mode. That's pointless work on a divider drag.

**Step 2: Build and look**

Run: `npm run build && npm run deploy`
Manual: Cmd+R. The left sidebar shows the nav column (Note button, Notes, Tasks, Templates, Notebooks with indented folders and counts, Tags) and an empty right column. Clicking an item highlights it. Dragging the divider resizes the nav column, and the width survives a reload.

(Styling arrives in Task 17; until then it'll look plain.)

**Step 3: Commit**

```bash
git add src/sidebar/view.ts
git commit -m "feat(sidebar): two-column view with nav and resizable divider"
```

---

### Task 15: Note list: header, cards, incremental rendering

**Files:**
- Modify: `src/sidebar/view.ts`, replacing the `renderList` / `markActive` stubs and adding helpers

**Step 1: Implement the list**

```ts
  private renderList(): void {
    this.disconnectObservers();
    const scroll = this.bodyEl.scrollTop;
    this.headerEl.empty();
    this.filtersEl.empty();
    this.bodyEl.empty();

    if (Platform.isMobile) {
      const back = this.headerEl.createDiv("ps-back");
      setIcon(back, "chevron-left");
      back.addEventListener("click", () => {
        this.mobilePane = "nav";
        this.render();
      });
    }

    if (this.place.kind === "tasks") {
      this.renderTasks();
    } else if (this.place.kind === "templates" && !templateOptions(this.app).folder) {
      this.renderHeader("Templates", null);
      const empty = this.bodyEl.createDiv("ps-empty");
      empty.createDiv({ text: "No templates folder is set." });
      const button = empty.createEl("button", { text: "Choose folder" });
      button.addEventListener("click", () => openSettingsTab(this.app, "templates"));
    } else {
      const list = notesFor(this.plugin.index.all(), this.place, this.queryOptions());
      this.renderHeader(this.placeTitle(), list.length);
      if (!list.length) this.bodyEl.createDiv({ cls: "ps-empty", text: "No notes" });
      const items: Array<{ label: string } | { note: NoteSummary }> = [];
      for (const group of groupNotes(list, this.sort)) {
        if (group.label) items.push({ label: group.label });
        for (const note of group.notes) items.push({ note });
      }
      this.renderIncrementally(items.length, (i) => {
        const item = items[i];
        if ("label" in item) this.bodyEl.createDiv({ cls: "ps-group-label", text: item.label });
        else this.renderCard(item.note);
      });
    }
    this.bodyEl.scrollTop = scroll;
  }

  /** Render `count` items in batches as the user scrolls, not all at once. */
  private renderIncrementally(count: number, renderAt: (i: number) => void): void {
    let next = 0;
    const step = () => {
      const end = Math.min(next + BATCH, count);
      for (; next < end; next++) renderAt(next);
      if (next >= count) return;
      const sentinel = this.bodyEl.createDiv("ps-sentinel");
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer.disconnect();
          sentinel.remove();
          step();
        },
        { root: this.bodyEl }
      );
      observer.observe(sentinel);
      this.observers.push(observer);
    };
    step();
  }

  private renderHeader(title: string, count: number | null): void {
    const row = this.headerEl.createDiv("ps-header-row");
    row.createSpan({ cls: "ps-title", text: title });
    if (count !== null) row.createSpan({ cls: "ps-count", text: String(count) });
    const actions = row.createDiv("ps-actions");

    const add = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "New note" } });
    setIcon(add, "file-plus-2");
    add.addEventListener("click", () => void createNote(this.app, this.currentFolder()));

    if (this.place.kind !== "tasks") {
      const sort = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "Sort" } });
      setIcon(sort, "arrow-up-down");
      sort.addEventListener("click", (evt) => {
        const menu = new Menu();
        const options: Array<[SortKey, string]> = [
          ["modified", "Date updated"],
          ["created", "Date created"],
          ["title", "Title"],
        ];
        for (const [key, label] of options) {
          menu.addItem((item) =>
            item.setTitle(label).setChecked(this.sort === key).onClick(() => {
              this.sort = key;
              this.renderList();
            })
          );
        }
        menu.showAtMouseEvent(evt);
      });
    }
  }

  private placeTitle(): string {
    switch (this.place.kind) {
      case "notes":
        return "Notes";
      case "tasks":
        return "Tasks";
      case "templates":
        return "Templates";
      case "notebook":
        return this.place.folder.split("/").pop()!;
      case "tag":
        return `#${this.place.tag}`;
    }
  }

  private renderCard(note: NoteSummary): void {
    const card = this.bodyEl.createDiv({ cls: "ps-card", attr: { "data-path": note.path } });
    card.toggleClass("is-active", this.app.workspace.getActiveFile()?.path === note.path);
    const text = card.createDiv("ps-card-text");

    const title = text.createDiv("ps-card-title");
    title.createSpan({ text: note.title });
    if (note.pinned) setIcon(title.createSpan("ps-card-pin"), "pin");
    if (note.snippet) text.createDiv({ cls: "ps-card-snippet", text: note.snippet });

    const { closed, total } = taskProgress(note);
    if (total) {
      const chip = text.createDiv("ps-card-tasks");
      setIcon(chip.createSpan(), "check-circle-2");
      chip.createSpan({ text: `${closed}/${total}` });
    }

    const meta = text.createDiv("ps-card-meta");
    meta.createSpan({ cls: "ps-card-date", text: cardDate(this.sort === "created" ? note.ctime : note.mtime) });
    for (const tag of note.tags.slice(0, 3)) meta.createSpan({ cls: "ps-card-tag", text: tag });

    const src = this.imageSrc(note);
    if (src) card.createDiv("ps-card-thumb").createEl("img", { attr: { src, loading: "lazy", alt: "" } });

    card.addEventListener("click", (evt) => {
      const file = this.app.vault.getAbstractFileByPath(note.path);
      if (!(file instanceof TFile)) return;
      if (this.place.kind === "templates") {
        void createNote(this.app, null, file);
        return;
      }
      void openFile(this.app, file, Keymap.isModEvent(evt));
    });
    card.addEventListener("contextmenu", (evt) => this.cardMenu(evt, note));
  }

  private cardMenu(evt: MouseEvent, note: NoteSummary): void {
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) return;
    evt.preventDefault();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(note.pinned ? "Unpin note" : "Pin note")
        .setIcon(note.pinned ? "pin-off" : "pin")
        .onClick(() => void togglePin(this.app, file))
    );
    if (this.place.kind === "templates") {
      menu.addItem((item) =>
        item.setTitle("Edit template").setIcon("pencil").onClick(() => void openFile(this.app, file, false))
      );
    }
    menu.addSeparator();
    // Obsidian's own file menu: rename, move to folder (= change notebook), delete, plugins' items.
    this.app.workspace.trigger("file-menu", menu, file, "plainsight-sidebar");
    menu.showAtMouseEvent(evt);
  }

  private imageSrc(note: NoteSummary): string | null {
    const target = note.thumbnail;
    if (!target) return null;
    if (/^https?:\/\//i.test(target)) return target;
    const file = this.app.metadataCache.getFirstLinkpathDest(target, note.path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  /** Cheap highlight update when the user opens a note elsewhere. */
  private markActive(): void {
    const active = this.app.workspace.getActiveFile()?.path;
    this.bodyEl.querySelectorAll<HTMLElement>(".ps-card").forEach((el) => {
      el.toggleClass("is-active", el.dataset.path === active);
    });
  }
```

Remove the `renderTasks` call error for now by adding a temporary `private renderTasks(): void {}`. Task 16 replaces it.

**Step 2: Build and look**

Run: `npm run build && npm run deploy`
Manual (Cmd+R), against real notes:
- Notes shows pinned first, then month groups ("October 2026"), with cards showing title, snippet, `n/m` for notes with tasks, date and tags.
- **Check snippet quality on ~10 real notes**, especially the diary notes that open with frontmatter and callouts. Note any that show junk and fix `cleanLine` with a test first. This is the design's flagged risk.
- Clicking a card opens the note in the main area; Cmd-click opens a new tab.
- Right-click shows Pin plus Obsidian's own file menu (Move file to…, Rename, Delete).
- Pinning a note floats it into "Pinned Notes" within about 150ms, and its frontmatter gains `pinned: true` and nothing else.
- Search narrows the list as you type, and the input keeps focus.
- A notebook shows its notes and its subfolders' notes.
- Scrolling to the end of "Notes" keeps loading cards.

**Step 3: Commit**

```bash
git add src/sidebar/view.ts
git commit -m "feat(sidebar): note cards with groups, search, sort and context menu"
```

---

### Task 16: Task rows in the list

**Files:**
- Modify: `src/sidebar/view.ts`, replacing the temporary `renderTasks`

**Step 1: Implement**

```ts
  private renderTasks(): void {
    const rows = taskRows(this.plugin.index.all(), this.taskFilter, localISODate());
    this.renderHeader("Tasks", rows.length);

    const filters: Array<[TaskFilter, string]> = [
      ["open", "Open"],
      ["overdue", "Overdue"],
      ["done", "Done"],
    ];
    for (const [key, label] of filters) {
      const tab = this.filtersEl.createDiv({ cls: "ps-filter", text: label });
      tab.toggleClass("is-active", this.taskFilter === key);
      tab.addEventListener("click", () => {
        this.taskFilter = key;
        this.renderList();
      });
    }

    if (!rows.length) this.bodyEl.createDiv({ cls: "ps-empty", text: "No tasks" });
    const today = localISODate();
    this.renderIncrementally(rows.length, (i) => {
      const { note, task } = rows[i];
      const row = this.bodyEl.createDiv("ps-task");
      const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      box.checked = isClosed(task);
      box.addEventListener("click", (evt) => evt.stopPropagation());
      box.addEventListener("change", () => void toggleTask(this.app, note.path, task.line, task.text));

      const body = row.createDiv("ps-task-body");
      body.createDiv({ cls: "ps-task-text", text: taskDisplayText(task.text) || task.text });
      const meta = body.createDiv("ps-task-meta");
      meta.createSpan({ text: note.title });
      if (task.due) {
        const due = meta.createSpan({ cls: "ps-task-due", text: task.due });
        due.toggleClass("is-overdue", !isClosed(task) && task.due < today);
      }

      row.addEventListener("click", (evt) => {
        const file = this.app.vault.getAbstractFileByPath(note.path);
        if (file instanceof TFile) void openFile(this.app, file, Keymap.isModEvent(evt), task.line);
      });
    });
  }
```

**Step 2: Build and look**

Run: `npm run build && npm run deploy`
Manual (Cmd+R). **Do this in a scratch note first**, not the diary files:
- Create `Scratch/tasks.md` with `- [ ] plain`, `- [ ] due 📅 2026-10-01`, and `- [ ] recurring 🔁 every day 📅 2026-10-07`.
- Tasks → Open lists them, earliest due first; Overdue shows the 2026-10-01 one, with its date in red.
- Tick "plain": the file's line becomes `- [x] plain ✅ <today>`. The ✅ date proves it went through the Tasks plugin, not the fallback.
- Tick "recurring": Tasks inserts the next occurrence on a new line, and the row list updates.
- Edit the scratch note to move lines around, then tick a stale row: you get the "That note changed" notice and the file is unchanged.
- Clicking a row's text opens the note with the cursor on that line.
- Confirm with `git diff`-style inspection (or by opening the file) that nothing else in the note changed.

**Step 3: Commit**

```bash
git add src/sidebar/view.ts
git commit -m "feat(sidebar): cross-note task rows with Tasks-plugin toggling"
```

---

### Task 17: Styling

**Files:**
- Modify: `styles.css` (append)

**Step 1: Append the sidebar styles**

```css
/* ---------- Plainsight notes sidebar ---------- */
.ps-sidebar {
  display: flex;
  height: 100%;
  padding: 0 !important;
  overflow: hidden;
  font-size: var(--font-ui-small);
}
.ps-nav {
  flex: 0 0 var(--ps-nav-width, 200px);
  overflow-y: auto;
  padding: 10px 6px;
  background: var(--background-secondary);
}
.ps-divider {
  flex: 0 0 4px;
  cursor: col-resize;
  background: var(--background-modifier-border);
}
.ps-divider:hover {
  background: var(--interactive-accent);
}
.ps-list {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--background-primary);
}

/* Nav */
.ps-new-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 4px 12px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  font-weight: 600;
  cursor: pointer;
}
.ps-nav-heading,
.ps-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
}
.ps-nav-heading {
  margin-top: 10px;
  color: var(--text-muted);
}
.ps-nav-item {
  padding-left: calc(8px + var(--ps-depth, 0) * 14px);
  cursor: pointer;
  color: var(--text-normal);
}
.ps-nav-item:hover {
  background: var(--background-modifier-hover);
}
.ps-nav-item.is-active {
  background: var(--background-modifier-active-hover);
  font-weight: 600;
}
.ps-nav-icon {
  display: inline-flex;
  width: 16px;
  color: var(--text-muted);
}
.ps-nav-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-nav-count {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

/* List header */
.ps-list-header {
  padding: 14px 14px 6px;
}
.ps-header-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ps-title {
  font-size: 1.5em;
  font-weight: 700;
}
.ps-count {
  color: var(--text-faint);
}
.ps-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.ps-action,
.ps-back {
  display: inline-flex;
  padding: 4px;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
}
.ps-action:hover,
.ps-back:hover {
  background: var(--background-modifier-hover);
}
.ps-search {
  margin: 0 14px 8px;
  width: calc(100% - 28px);
}
.ps-filters {
  display: flex;
  gap: 6px;
  padding: 0 14px 6px;
}
.ps-filters:empty {
  display: none;
}
.ps-filter {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--background-modifier-border);
  cursor: pointer;
}
.ps-filter.is-active {
  background: var(--background-modifier-active-hover);
  font-weight: 600;
}

/* List body */
.ps-list-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 8px 16px;
}
.ps-group-label {
  padding: 14px 8px 6px;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: 600;
}
.ps-empty {
  padding: 24px 8px;
  color: var(--text-muted);
  text-align: center;
}
.ps-empty button {
  margin-top: 10px;
}
.ps-card {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  cursor: pointer;
}
.ps-card:hover {
  background: var(--background-modifier-hover);
}
.ps-card.is-active {
  outline: 2px solid var(--interactive-accent);
  outline-offset: -2px;
}
.ps-card-text {
  flex: 1 1 auto;
  min-width: 0;
}
.ps-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-card-pin {
  display: inline-flex;
  color: var(--color-orange);
}
.ps-card-snippet {
  margin-top: 4px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ps-card-tasks {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(var(--color-purple-rgb), 0.12);
  color: var(--color-purple);
}
.ps-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.ps-card-tag {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--background-modifier-hover);
  color: var(--text-muted);
}
.ps-card-thumb {
  flex: 0 0 64px;
}
.ps-card-thumb img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 4px;
}

/* Task rows */
.ps-task {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px;
  border-bottom: 1px solid var(--background-modifier-border);
  cursor: pointer;
}
.ps-task:hover {
  background: var(--background-modifier-hover);
}
.ps-task-body {
  min-width: 0;
}
.ps-task-meta {
  display: flex;
  gap: 8px;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.ps-task-due.is-overdue {
  color: var(--color-red);
}

/* Mobile: one column at a time */
.ps-sidebar.is-mobile .ps-divider {
  display: none;
}
.ps-sidebar.is-mobile .ps-nav {
  flex: 1 1 auto;
}
.ps-sidebar.is-mobile .ps-list {
  display: none;
}
.ps-sidebar.is-mobile.show-list .ps-nav {
  display: none;
}
.ps-sidebar.is-mobile.show-list .ps-list {
  display: flex;
}
```

`--color-purple-rgb` is defined by Obsidian's base theme on `body`, so it does resolve here. This is not the `.cm-line` callout-variable trap; if the chip shows no tint, fall back to a literal triple.

**Step 2: Build and look**

Run: `npm run deploy`
Manual (Cmd+R): compare side by side with the Evernote screenshot. Calm grey nav, green-ish accent "Note" pill (it follows the theme accent), cards with bold titles, muted two-line snippets, task chips and right-hand thumbnails. Check light and dark themes. Widen the sidebar to ~520px for a fair look.

**Step 3: Commit**

```bash
git add styles.css
git commit -m "feat(sidebar): styling"
```

---

### Task 18: Final verification and review

**Step 1: Full suite and build**

Run: `npx vitest run && npm run build`
Expected: all tests pass (99 existing + ~54 sidebar); the build is clean.

**Step 2: Smoke test in the vault** (Cmd+R after `npm run deploy`)

- [ ] Turn off the core File explorer (Settings → Core plugins). The Notes sidebar is the only file browser and covers daily use.
- [ ] Bookmark a note, a folder and a search in the core Bookmarks pane. All three appear under Shortcuts and open correctly (the search opens Obsidian's search pane).
- [ ] Set a templates folder, add a template using `{{title}}` and `{{date}}`, then click it in Templates. A new "Untitled" note is created with the placeholders filled, in the current notebook or the default location.
- [ ] Rename a folder. Its notebook entry and notes follow, and nothing is duplicated.
- [ ] Delete a note. It disappears from the list and counts.
- [ ] Edit a note's body. Its card's snippet and date update within a moment.
- [ ] Turn the "Notes sidebar" setting off. The view closes. Turn it on again and it reopens.
- [ ] Editor features are unaffected: headings, callouts, and the `···` picker.
- [ ] (When a phone is to hand) Mobile shows the nav, tapping a place shows the list, and Back returns.

**Step 3: Single end review**

Per Magnus's preference (memory: prefers-speed-over-ceremony), run one review over the whole sidebar diff rather than per-task reviews. Use @superpowers:requesting-code-review, focusing on: the write-safety rule in `actions.ts`, stale-index handling, event-listener cleanup in `onClose`, and anything in `core/` that imports `obsidian`.

**Step 4: Update memory**

Record anything non-obvious discovered during the build in `obsidian-wysiwyg-editor-state.md` (for example, real-note snippet quirks, or Tasks API behaviour).

**Step 5: Commit any review fixes**

```bash
git add -A
git commit -m "fix(sidebar): review fixes"
```

---

## Known limitations (deliberate, for now)

- Search covers title, tags and the first 20,000 characters of each note, which is plenty for this vault.
- Folders with no notes are hidden from Notebooks, so a freshly created empty folder won't appear until it holds a note.
- No drag-and-drop between notebooks yet; "Move file to…" in the right-click menu does it.
- No task detail dialog, Reminders or Spaces (see the design doc).
