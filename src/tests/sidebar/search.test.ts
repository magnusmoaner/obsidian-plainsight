import { describe, expect, test } from "vitest";
import {
  excerpt,
  matchAttachment,
  matchNote,
  matchTask,
  parseQuery,
  rankNotes,
  rankTasks,
  toObsidianQuery,
  toOmnisearchQuery,
  toTasksQuery,
} from "../../sidebar/core/search";
import { TaskItem } from "../../sidebar/core/types";
import { note } from "./fixtures";

const today = "2026-10-15";
const task = (text: string, status = " ", line = 0): TaskItem => ({ line, status, text, due: null, section: null, done: null });

describe("parseQuery", () => {
  test("words, phrases and exclusions", () => {
    const q = parseQuery('Bank  "monthly fee" -loan -"old account"');
    expect(q.words).toEqual(["bank"]);
    expect(q.phrases).toEqual(["monthly fee"]);
    expect(q.excludes).toEqual(["loan", "old account"]);
  });

  test("tags, paths, file names, kinds and task filters", () => {
    const q = parseQuery('#work -#home tag:client path:"Area 1" in:Inbox file:plan is:overdue due:week scheduled:today priority:high');
    expect(q.tags).toEqual(["work", "client"]);
    expect(q.excludeTags).toEqual(["home"]);
    expect(q.paths).toEqual(["area 1", "inbox"]);
    expect(q.files).toEqual(["plan"]);
    expect(q.is).toEqual(["overdue"]);
    expect(q.due).toEqual({ kind: "week" });
    expect(q.scheduled).toEqual({ kind: "today" });
    expect(q.priority).toBe("high");
  });

  test("date comparisons, and unknown keys stay words", () => {
    expect(parseQuery("due:<2026-11-01").due).toEqual({ kind: "before", date: "2026-11-01" });
    expect(parseQuery("due:>2026-11-01").due).toEqual({ kind: "after", date: "2026-11-01" });
    expect(parseQuery("due:2026-11-01").due).toEqual({ kind: "on", date: "2026-11-01" });
    expect(parseQuery("due:none").due).toEqual({ kind: "none" });
    expect(parseQuery("meet at 10:30").words).toEqual(["meet", "at", "10:30"]);
    expect(parseQuery("due:someday").words).toEqual(["due:someday"]);
  });

  test("an empty query is empty", () => {
    expect(parseQuery("   ").empty).toBe(true);
    expect(parseQuery("x").empty).toBe(false);
  });
});

describe("matchNote (the list filter)", () => {
  const n = note("Work/Client/Plan.md", {
    title: "Plan",
    tags: ["work/client", "q4"],
    searchText: "plan work/client q4 the monthly fee goes up",
    tasks: [task("Call the bank 📅 2026-10-14", " ", 3), task("Paid ✅ 2026-10-01", "x", 4)],
  });
  test("words, phrases, exclusions", () => {
    expect(matchNote(n, parseQuery("monthly fee"), today)).toBe(true);
    expect(matchNote(n, parseQuery('"fee goes"'), today)).toBe(true);
    expect(matchNote(n, parseQuery("fee -monthly"), today)).toBe(false);
  });
  test("a tag matches nested tags, a path matches anywhere in the path", () => {
    expect(matchNote(n, parseQuery("#work"), today)).toBe(true);
    expect(matchNote(n, parseQuery("#wor"), today)).toBe(false);
    expect(matchNote(n, parseQuery("-#q4"), today)).toBe(false);
    expect(matchNote(n, parseQuery("path:client"), today)).toBe(true);
    expect(matchNote(n, parseQuery("file:pla"), today)).toBe(true);
  });
  test("task filters keep notes with a matching task", () => {
    expect(matchNote(n, parseQuery("is:overdue"), today)).toBe(true);
    expect(matchNote(n, parseQuery("due:today"), today)).toBe(false);
    expect(matchNote(n, parseQuery("is:board"), today)).toBe(false);
  });
});

describe("matchTask (the tasks filter)", () => {
  const n = note("Inbox.md", { title: "Inbox", tags: ["home"] });
  const row = (text: string, status = " ") => ({ note: n, task: task(text, status) });
  test("words match the task or its note", () => {
    expect(matchTask(row("Call the bank"), parseQuery("bank"), today)).toBe(true);
    expect(matchTask(row("Call the bank"), parseQuery("inbox call"), today)).toBe(true);
  });
  test("dates, priority, recurrence, tags", () => {
    expect(matchTask(row("a 📅 2026-10-15"), parseQuery("due:today"), today)).toBe(true);
    expect(matchTask(row("a 📅 2026-10-20"), parseQuery("due:week"), today)).toBe(true);
    expect(matchTask(row("a 📅 2026-10-30"), parseQuery("due:week"), today)).toBe(false);
    expect(matchTask(row("a 📅 2026-10-14"), parseQuery("is:overdue"), today)).toBe(true);
    expect(matchTask(row("a 📅 2026-10-14", "x"), parseQuery("is:overdue"), today)).toBe(false);
    expect(matchTask(row("a 📅 2026-10-14"), parseQuery("due:<2026-10-15"), today)).toBe(true);
    expect(matchTask(row("a"), parseQuery("due:none"), today)).toBe(true);
    expect(matchTask(row("a ⏳ 2026-10-15"), parseQuery("scheduled:today"), today)).toBe(true);
    expect(matchTask(row("a ⏫"), parseQuery("priority:high"), today)).toBe(true);
    expect(matchTask(row("a"), parseQuery("priority:normal"), today)).toBe(true);
    expect(matchTask(row("a 🔁 every week 📅 2026-10-20"), parseQuery("is:recurring"), today)).toBe(true);
    expect(matchTask(row("a #errand"), parseQuery("#errand"), today)).toBe(true);
    expect(matchTask(row("a"), parseQuery("#home"), today)).toBe(true); // the note's tag
    expect(matchTask(row("a", "x"), parseQuery("is:done"), today)).toBe(true);
  });
});

describe("matchAttachment", () => {
  const file = { path: "Attachments/Statement 2026.pdf", name: "Statement 2026.pdf", folder: "Attachments", extension: "pdf", size: 1, mtime: 0, ctime: 0 };
  test("by name or extracted text; tags and task filters never match", () => {
    expect(matchAttachment(file, "balance at the bank", parseQuery("statement"))).toBe(true);
    expect(matchAttachment(file, "balance at the bank", parseQuery("balance"))).toBe(true);
    expect(matchAttachment(file, "", parseQuery("#work"))).toBe(false);
    expect(matchAttachment(file, "", parseQuery("is:overdue"))).toBe(false);
  });
});

describe("rankNotes", () => {
  const notes = [
    note("a.md", { title: "Groceries", searchText: "groceries milk bank bank bank", mtime: 1 }),
    note("b.md", { title: "Bank", searchText: "bank accounts and cards", mtime: 2 }),
    note("c.md", { title: "Trip", searchText: "trip to the coast", mtime: 3 }),
    note("d.md", { title: "Bank fees", searchText: "bank fees explained", mtime: 4 }),
  ];
  test("a title match outranks words in the text; non-matches are left out", () => {
    expect(rankNotes(notes, parseQuery("bank"), today).map((n) => n.path)).toEqual(["b.md", "d.md", "a.md"]);
  });
  test("filters only: most recent first", () => {
    expect(rankNotes(notes, parseQuery("is:note"), today).map((n) => n.path)).toEqual(["d.md", "c.md", "b.md", "a.md"]);
  });
});

describe("rankTasks", () => {
  test("open before done, then soonest due", () => {
    const n = note("Inbox.md", { title: "Inbox" });
    const rows = [
      { note: n, task: task("Pay bank ✅ 2026-10-01", "x", 1) },
      { note: n, task: task("Bank call 📅 2026-10-20", " ", 2) },
      { note: n, task: task("Bank form 📅 2026-10-16", " ", 3) },
    ];
    expect(rankTasks(rows, parseQuery("bank"), today).map((r) => r.task.line)).toEqual([3, 2, 1]);
  });
});

describe("toObsidianQuery", () => {
  test("translates what Obsidian search understands, drops the rest", () => {
    expect(toObsidianQuery(parseQuery('bank "monthly fee" -loan #work path:"Area 1" file:plan due:week'))).toBe(
      'bank "monthly fee" -loan tag:#work path:"area 1" file:plan'
    );
  });
});

describe("excerpt", () => {
  test("a window around the first match, with its position", () => {
    const text = "---\ntitle: x\n---\n# Heading\nSome intro text. The bank charges a monthly fee on every account.";
    const e = excerpt(text, parseQuery("bank"), 40)!;
    expect(e.text).toContain("bank");
    expect(e.text.slice(e.highlights[0][0], e.highlights[0][1]).toLowerCase()).toBe("bank");
    expect(e.text.startsWith("---")).toBe(false);
  });
  test("null when nothing matches or there are no words", () => {
    expect(excerpt("nothing here", parseQuery("bank"))).toBeNull();
    expect(excerpt("nothing here", parseQuery("#tag"))).toBeNull();
  });
});

describe("toTasksQuery", () => {
  test("a Tasks code block in the plugin's documented wording", () => {
    const input = 'bank "monthly fee" -loan #work -#home path:Inbox file:plan is:overdue priority:high';
    expect(toTasksQuery(parseQuery(input), input)).toBe(
      [
        "```tasks",
        `# From Plainsight search: ${input}`,
        "not done",
        "due before today",
        "priority is high",
        "tags include #work",
        "tags do not include #home",
        "path includes inbox",
        "filename includes plan",
        "description includes bank",
        "description includes monthly fee",
        "description does not include loan",
        "```",
      ].join("\n")
    );
  });

  test("date values", () => {
    const lines = (input: string) => toTasksQuery(parseQuery(input), input).split("\n").slice(2, -1);
    expect(lines("due:today")).toEqual(["due on today"]);
    expect(lines("due:tomorrow")).toEqual(["due on tomorrow"]);
    expect(lines("due:none")).toEqual(["no due date"]);
    expect(lines("due:any")).toEqual(["has due date"]);
    expect(lines("due:<2026-11-01")).toEqual(["due before 2026-11-01"]);
    expect(lines("scheduled:>2026-11-01")).toEqual(["scheduled after 2026-11-01"]);
    expect(lines("scheduled:2026-11-01")).toEqual(["scheduled on 2026-11-01"]);
    expect(lines("priority:normal is:recurring is:done")).toEqual(["done", "is recurring", "priority is none"]);
  });

  test("the next 7 days, which Tasks has no documented filter for, says how it's written", () => {
    expect(toTasksQuery(parseQuery("due:week"), "due:week").split("\n").slice(2, -1)).toEqual([
      "# due:week means the next 7 days",
      "due on or after today",
      "due on or before in 7 days",
    ]);
  });

  test("note kinds have no Tasks equivalent and are noted, not dropped silently", () => {
    expect(toTasksQuery(parseQuery("is:board"), "is:board").split("\n").slice(2, -1)).toEqual([
      "# Tasks has no filter for: is:board",
    ]);
  });
});

describe("toOmnisearchQuery", () => {
  test("words, phrases and exclusions", () => {
    expect(toOmnisearchQuery(parseQuery('bank "monthly fee" -loan #work due:week'))).toBe('bank "monthly fee" -loan');
  });
});

