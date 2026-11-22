import { describe, expect, it } from "vitest";
import { addMonths, buildTaskLine, duePresets, monthGrid } from "../../sidebar/core/task-line";

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

  it("adds Tasks' global filter and created date, as its own dialog would", () => {
    expect(
      buildTaskLine({ text: "Call", priority: "high", due: "2026-10-12", globalFilter: "#task", created: "2026-10-11" })
    ).toBe("- [ ] #task Call ⏫ ➕ 2026-10-11 📅 2026-10-12");
    // Not added twice when typed.
    expect(buildTaskLine({ text: "Call #task", globalFilter: "#task" })).toBe("- [ ] Call #task");
    expect(buildTaskLine({ text: "x", globalFilter: "  " })).toBe("- [ ] x");
  });

  it("writes every field in Tasks' order", () => {
    expect(
      buildTaskLine({
        text: "Pay rent",
        priority: "medium",
        recurrence: "every month",
        whenDone: true,
        created: "2026-10-11",
        start: "2026-10-20",
        scheduled: "2026-10-25",
        due: "2026-11-01",
      })
    ).toBe("- [ ] Pay rent 🔼 🔁 every month when done ➕ 2026-10-11 🛫 2026-10-20 ⏳ 2026-10-25 📅 2026-11-01");
  });

  it("refuses a repeat without a date, or one it doesn't offer", () => {
    expect(buildTaskLine({ text: "x", recurrence: "every week" })).toBeNull();
    expect(buildTaskLine({ text: "x", recurrence: "every 🔥", due: "2026-10-12" })).toBeNull();
    expect(buildTaskLine({ text: "x", recurrence: "every week", scheduled: "2026-10-12" })).toBe(
      "- [ ] x 🔁 every week ⏳ 2026-10-12"
    );
    expect(buildTaskLine({ text: "x", start: "2026-1-1" })).toBeNull();
  });

  it("keeps the task on one line", () => {
    expect(buildTaskLine({ text: "  a\nb\r\n  c  " })).toBe("- [ ] a b c");
  });

  it("refuses empty text and malformed dates", () => {
    expect(buildTaskLine({ text: "   " })).toBeNull();
    expect(buildTaskLine({ text: "x", due: "12/10/2026" })).toBeNull();
  });
});

describe("buildTaskLine in the Dataview format", () => {
  it("writes each field as [key:: value], two spaces apart, in Tasks' order", () => {
    expect(
      buildTaskLine({ text: "Pay rent", format: "dataview", priority: "high", recurrence: "every month", whenDone: true, created: "2026-11-22", due: "2026-12-01" })
    ).toBe("- [ ] Pay rent  [priority:: high]  [repeat:: every month when done]  [created:: 2026-11-22]  [due:: 2026-12-01]");
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

describe("monthGrid", () => {
  it("starts on the Monday on or before the 1st and runs six weeks", () => {
    const days = monthGrid("2026-11-20"); // November 2026 starts on a Sunday
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-10-26");
    expect(days[6]).toBe("2026-11-01");
    expect(days[41]).toBe("2026-12-06");
  });
  it("starts on the 1st when it is a Monday", () => {
    expect(monthGrid("2026-06-15")[0]).toBe("2026-06-01");
  });
});

describe("addMonths", () => {
  it("moves to the first of another month, across years", () => {
    expect(addMonths("2026-11-20", 1)).toBe("2026-12-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
});
