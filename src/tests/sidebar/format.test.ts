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
