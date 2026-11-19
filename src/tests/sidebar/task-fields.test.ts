import { describe, expect, test } from "vitest";
import { addTaskTag, setTaskField, taskFields } from "../../sidebar/core/task-fields";

/** The text with the hidden spans taken out: what a note shows. */
const shown = (text: string, cursor?: number) => {
  let out = "";
  let at = 0;
  for (const s of taskFields(text, cursor).hidden) {
    out += text.slice(at, s.from);
    at = s.to;
  }
  return out + text.slice(at);
};

describe("taskFields", () => {
  test("a plain task hides nothing", () => {
    expect(taskFields("Water the plants").hidden).toEqual([]);
    expect(shown("Water the plants ")).toBe("Water the plants ");
  });

  test("fields are hidden with the space before them, and read as details", () => {
    const text = "Call the plumber ⏫ 🔁 every week 📅 2026-11-20";
    expect(shown(text)).toBe("Call the plumber");
    const { details } = taskFields(text);
    expect(details).toMatchObject({ priority: "high", recurrence: "every week", due: "2026-11-20", description: "Call the plumber" });
  });

  test("fields without badges are hidden too", () => {
    expect(shown("Paint the fence 🆔 abc123 ⛔ xyz789 ➕ 2026-11-01 🏁 delete")).toBe("Paint the fence");
  });

  test("a variation selector after an emoji is part of the field", () => {
    expect(shown("Book flights ⏳️ 2026-12-01")).toBe("Book flights");
    expect(taskFields("Book flights ⏳️ 2026-12-01").details.scheduled).toBe("2026-12-01");
  });

  test("trailing space after the fields is hidden with them", () => {
    expect(taskFields("Buy milk 📅 2026-11-20 ").hidden).toEqual([{ from: 8, to: "Buy milk 📅 2026-11-20 ".length }]);
  });

  test("tags at the ends are badges; mid-sentence they stay words", () => {
    expect(shown("#garden Water the plants #weekly")).toBe("Water the plants");
    expect(taskFields("#garden Water the plants #weekly").details.badgeTags).toEqual(["garden", "weekly"]);
    expect(shown("Call #mom about the trip")).toBe("Call #mom about the trip");
  });

  test("a task that is only tags keeps them as its text", () => {
    expect(shown("#errand 📅 2026-11-20")).toBe("#errand");
  });

  test("tags among the fields are badges", () => {
    expect(shown("Fix the bike 📅 2026-11-20 #outdoor")).toBe("Fix the bike");
  });

  test("a half-typed field stays text", () => {
    expect(shown("Buy milk 📅 2026-1")).toBe("Buy milk 📅 2026-1");
    expect(shown("Buy milk 🔁")).toBe("Buy milk 🔁");
  });

  test("a field or tag ending at the cursor is still being typed", () => {
    const text = "Water the plants #gard";
    expect(shown(text, text.length)).toBe(text);
    expect(shown(`${text} `, text.length + 1)).toBe("Water the plants");
    expect(shown("Buy milk 📅 2026-11-20", "Buy milk 📅 2026-11-20".length)).toBe("Buy milk 📅 2026-11-20");
  });

  test("a space just typed after the text stays visible", () => {
    const text = "Buy milk  ⏫";
    expect(shown(text, 9)).toBe("Buy milk ");
    expect(shown(text)).toBe("Buy milk");
  });

  test("only keep or delete belong to 🏁", () => {
    expect(shown("Water plants 🏁a")).toBe("Water plants 🏁a");
    expect(shown("Water plants 🏁 keep")).toBe("Water plants");
  });

  test("a numeric #123 isn't a tag", () => {
    expect(shown("Reply to issue #123")).toBe("Reply to issue #123");
  });
});

describe("setTaskField", () => {
  test("changes a field in place", () => {
    expect(setTaskField("Buy milk ⏫ 📅 2026-11-20", "due", "2026-11-21")).toBe("Buy milk ⏫ 📅 2026-11-21");
    expect(setTaskField("Buy milk ⏫ 📅 2026-11-20", "priority", "low")).toBe("Buy milk 🔽 📅 2026-11-20");
  });

  test("removes a field and the space before it", () => {
    expect(setTaskField("Buy milk ⏫ 📅 2026-11-20", "priority", null)).toBe("Buy milk 📅 2026-11-20");
    expect(setTaskField("Buy milk 📅 2026-11-20", "due", null)).toBe("Buy milk");
  });

  test("adds a field where Tasks would write it", () => {
    expect(setTaskField("Buy milk", "due", "2026-11-20")).toBe("Buy milk 📅 2026-11-20");
    expect(setTaskField("Buy milk 📅 2026-11-20", "priority", "high")).toBe("Buy milk ⏫ 📅 2026-11-20");
    expect(setTaskField("Buy milk ⏫ 📅 2026-11-20", "scheduled", "2026-11-19")).toBe("Buy milk ⏫ ⏳ 2026-11-19 📅 2026-11-20");
    expect(setTaskField("Buy milk 📅 2026-11-20 ✅ 2026-11-21", "recurrence", "every week")).toBe(
      "Buy milk 🔁 every week 📅 2026-11-20 ✅ 2026-11-21"
    );
  });

  test("a new field goes after trailing tags, keeping them", () => {
    expect(setTaskField("Buy milk #shop", "due", "2026-11-20")).toBe("Buy milk #shop 📅 2026-11-20");
  });

  test("changes a repeat rule up to the next field", () => {
    expect(setTaskField("Pay rent 🔁 every month 📅 2026-12-01", "recurrence", "every week")).toBe(
      "Pay rent 🔁 every week 📅 2026-12-01"
    );
  });

  test("removes a tag by name", () => {
    expect(setTaskField("#home Buy milk #shop 📅 2026-11-20", "tag", "shop")).toBe("#home Buy milk 📅 2026-11-20");
    expect(setTaskField("#home Buy milk", "tag", "home")).toBe("Buy milk");
  });

  test("a duplicate field is folded into one", () => {
    expect(setTaskField("Buy milk 📅 2026-11-20 📅 2026-11-22", "due", "2026-11-25")).toBe("Buy milk 📅 2026-11-25");
  });
});

describe("addTaskTag", () => {
  test("goes after the words, before the fields", () => {
    expect(addTaskTag("Buy milk ⏫ 📅 2026-11-20", "shop")).toBe("Buy milk #shop ⏫ 📅 2026-11-20");
    expect(addTaskTag("Buy milk", "shop")).toBe("Buy milk #shop");
  });

  test("a tag it already has isn't added twice", () => {
    expect(addTaskTag("Buy milk #shop", "shop")).toBe("Buy milk #shop");
  });
});
