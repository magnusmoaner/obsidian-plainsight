import { describe, expect, it } from "vitest";
import { buildTaskLine, duePresets } from "../../sidebar/core/task-line";

describe("buildTaskLine", () => {
  it("writes a plain open task", () => {
    expect(buildTaskLine({ text: "Call the bank" })).toBe("- [ ] Call the bank");
  });

  it("adds priority then due date in Tasks' emoji format", () => {
    expect(buildTaskLine({ text: "Call", due: "2026-10-12", priority: "high" })).toBe(
      "- [ ] Call ⏫ 📅 2026-10-12"
    );
    expect(buildTaskLine({ text: "x", priority: "lowest" })).toBe("- [ ] x ⏬");
  });

  it("keeps the task on one line", () => {
    expect(buildTaskLine({ text: "  a\nb\r\n  c  " })).toBe("- [ ] a b c");
  });

  it("refuses empty text and malformed dates", () => {
    expect(buildTaskLine({ text: "   " })).toBeNull();
    expect(buildTaskLine({ text: "x", due: "12/10/2026" })).toBeNull();
  });
});

describe("duePresets", () => {
  it("gives today, tomorrow and next Monday", () => {
    // 2026-10-11 is a Sunday.
    expect(duePresets("2026-10-11")).toEqual([
      { label: "Today", date: "2026-10-11" },
      { label: "Tomorrow", date: "2026-10-12" },
      { label: "Next week", date: "2026-10-12" },
    ]);
    // From a Monday, next week is seven days on.
    expect(duePresets("2026-10-12")[2]).toEqual({ label: "Next week", date: "2026-10-19" });
  });
});
