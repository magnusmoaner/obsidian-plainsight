import { describe, expect, test } from "vitest";
import {
  matchTaskLine,
  parseTasks,
  taskDisplayText,
  taskTextColumn,
  toggleTaskLine,
} from "../../sidebar/core/tasks";

describe("parseTasks", () => {
  test("finds tasks with line numbers and statuses", () => {
    const text = "intro\n- [ ] open\n- [x] done\n* [/] doing";
    expect(parseTasks(text)).toEqual([
      { line: 1, status: " ", text: "open", due: null, section: null, done: null },
      { line: 2, status: "x", text: "done", due: null, section: null, done: null },
      { line: 3, status: "/", text: "doing", due: null, section: null, done: null },
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

  test("a trailing # with no space before it is heading text (C#)", () => {
    expect(parseTasks("## C#\n- [ ] a\n## Todo ##\n- [ ] b").map((t) => t.section)).toEqual([
      "C#",
      "Todo",
    ]);
  });

  test("reads the Tasks plugin completion date", () => {
    expect(parseTasks("- [x] Paid ✅ 2026-10-07")[0].done).toBe("2026-10-07");
  });

  test("records the nearest heading above each task", () => {
    const text = "- [ ] loose\n## Todo\n- [ ] a\n### Sub ##\n- [ ] b";
    expect(parseTasks(text).map((t) => t.section)).toEqual([null, "Todo", "Sub"]);
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

describe("matchTaskLine", () => {
  test("returns status and trimmed text", () => {
    expect(matchTaskLine("  - [x] Pay 📅 2026-10-09 \r")).toEqual({
      status: "x",
      text: "Pay 📅 2026-10-09",
    });
  });

  test("an empty task has empty text", () => {
    expect(matchTaskLine("- [ ]")).toEqual({ status: " ", text: "" });
  });

  test("null for headings and plain list items", () => {
    expect(matchTaskLine("## Notes")).toBeNull();
    expect(matchTaskLine("- item")).toBeNull();
  });
});

describe("taskTextColumn", () => {
  test("lands on the first letter of the task", () => {
    expect(taskTextColumn("- [ ] Buy milk")).toBe(6);
    expect(taskTextColumn("    * [x] Done 📅 2026-10-09")).toBe(10);
    expect(taskTextColumn("12. [/] Doing")).toBe(8);
  });
  test("0 for anything that isn't a task", () => {
    expect(taskTextColumn("## Heading")).toBe(0);
    expect(taskTextColumn("- plain item")).toBe(0);
  });
});
