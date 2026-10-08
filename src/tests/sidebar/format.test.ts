import { describe, expect, test } from "vitest";
import { applyTemplate, cardDate, dueDateLabel, localISODate } from "../../sidebar/core/format";

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

describe("dueDateLabel", () => {
  const today = "2026-10-08";
  test("near dates are relative", () => {
    expect(dueDateLabel("2026-10-08", today)).toBe("Today");
    expect(dueDateLabel("2026-10-09", today)).toBe("Tomorrow");
    expect(dueDateLabel("2026-10-07", today)).toBe("Yesterday");
    expect(dueDateLabel("2026-10-11", today)).toBe("in 3 days");
    expect(dueDateLabel("2026-10-05", today)).toBe("3 days ago");
  });
  test("a week or more away shows the date, with the year if it differs", () => {
    expect(dueDateLabel("2026-10-15", today)).toBe("Oct 15");
    expect(dueDateLabel("2026-01-27", today)).toBe("Jan 27");
    expect(dueDateLabel("2027-01-27", today)).toBe("Jan 27, 2027");
  });
  test("counts calendar days across month and year ends", () => {
    expect(dueDateLabel("2027-01-01", "2026-12-31")).toBe("Tomorrow");
  });
});
