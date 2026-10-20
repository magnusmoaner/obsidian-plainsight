import { describe, expect, test } from "vitest";
import { recurrenceLabel, taskDetails } from "../../sidebar/core/task-details";

describe("taskDetails", () => {
  test("a plain task has only a description", () => {
    expect(taskDetails("Call the bank")).toEqual({
      description: "Call the bank",
      tags: [],
      badgeTags: [],
      priority: null,
      due: null,
      scheduled: null,
      start: null,
      done: null,
      cancelled: null,
      recurrence: null,
    });
  });

  test("reads every Tasks field", () => {
    const d = taskDetails(
      "Pay rent 🔼 🔁 every month when done ➕ 2026-10-11 🛫 2026-10-20 ⏳ 2026-10-25 📅 2026-11-01"
    );
    expect(d).toMatchObject({
      description: "Pay rent",
      priority: "medium",
      recurrence: "every month when done",
      start: "2026-10-20",
      scheduled: "2026-10-25",
      due: "2026-11-01",
    });
  });

  test("each priority", () => {
    expect(taskDetails("a 🔺").priority).toBe("highest");
    expect(taskDetails("a ⏫").priority).toBe("high");
    expect(taskDetails("a 🔼").priority).toBe("medium");
    expect(taskDetails("a 🔽").priority).toBe("low");
    expect(taskDetails("a ⏬").priority).toBe("lowest");
  });

  test("done and cancelled dates, and the alternative scheduled marker", () => {
    expect(taskDetails("a ✅ 2026-10-01").done).toBe("2026-10-01");
    expect(taskDetails("a ❌ 2026-10-02").cancelled).toBe("2026-10-02");
    expect(taskDetails("a ⌛ 2026-10-03").scheduled).toBe("2026-10-03");
    expect(taskDetails("a 📅️ 2026-10-04").due).toBe("2026-10-04");
  });

  test("leading and trailing tags become badges; the description keeps its words", () => {
    const d = taskDetails("#work Call the bank #urgent 📅 2026-10-12 #later");
    expect(d.description).toBe("Call the bank");
    expect(d.badgeTags).toEqual(["work", "urgent", "later"]);
    expect(d.tags).toEqual(["work", "urgent", "later"]);
  });

  test("a tag mid-sentence stays in the text", () => {
    const d = taskDetails("Call #mom about the party");
    expect(d.description).toBe("Call #mom about the party");
    expect(d.badgeTags).toEqual([]);
    expect(d.tags).toEqual(["mom"]);
  });

  test("numbers and URL anchors aren't tags; a task of only tags keeps them as text", () => {
    expect(taskDetails("Fix #123 now").tags).toEqual([]);
    expect(taskDetails("Read https://example.com/page#section").tags).toEqual([]);
    expect(taskDetails("#idea")).toMatchObject({ description: "#idea", badgeTags: [], tags: ["idea"] });
  });
});

describe("recurrenceLabel", () => {
  test("capitalized, without 'when done'", () => {
    expect(recurrenceLabel("every week when done")).toBe("Every week");
    expect(recurrenceLabel("every 2 days")).toBe("Every 2 days");
  });
});
