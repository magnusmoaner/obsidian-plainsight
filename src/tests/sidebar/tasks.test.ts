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
