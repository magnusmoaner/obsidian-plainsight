import { describe, expect, test } from "vitest";
import {
  folderRows,
  groupNotes,
  notesFor,
  tagRows,
  taskProgress,
  taskRows,
} from "../../sidebar/core/queries";
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
    expect(groupNotes([note("a.md"), note("b.md")], "title").map((g) => g.label)).toEqual([""]);
  });

  test("no notes, no groups", () => {
    expect(groupNotes([], "modified")).toEqual([]);
  });
});

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

  test("tasks inside the templates folder are excluded", () => {
    const withTemplate = [...list, note("Templates/t.md", { tasks: [t(0, " ")] })];
    expect(keys(taskRows(withTemplate, "open", "2026-10-07", "Templates"))).toEqual([
      "b.md:0",
      "a.md:0",
      "a.md:2",
    ]);
  });

  test("taskProgress counts done and cancelled as closed", () => {
    expect(taskProgress(list[1])).toEqual({ closed: 1, total: 2 });
  });
});
