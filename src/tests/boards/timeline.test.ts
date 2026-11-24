import { describe, expect, test } from "vitest";
import { dayNumber, dayIn, isoDay, moveCardDates, placeCard, bucketAt, unitFor, weekday } from "../../boards/timeline";

describe("placeCard", () => {
  test("start and due make a bar", () => {
    expect(placeCard("Bake 🛫 2026-11-20 📅 2026-11-24", false)).toEqual({ kind: "bar", from: "2026-11-20", to: "2026-11-24", end: "due" });
  });
  test("a bar can end on the scheduled date", () => {
    expect(placeCard("Bake  [start:: 2026-11-20]  [scheduled:: 2026-11-22]", false)).toMatchObject({ kind: "bar", end: "scheduled" });
  });
  test("one date makes a mark on that day", () => {
    expect(placeCard("Call 📅 2026-11-24", false)).toEqual({ kind: "due", from: "2026-11-24", to: "2026-11-24" });
    expect(placeCard("Call ⏳ 2026-11-25", false)?.kind).toBe("scheduled");
    expect(placeCard("Call 🛫 2026-11-26", false)?.kind).toBe("start");
  });
  test("a start after the due date isn't a bar", () => {
    expect(placeCard("Odd 🛫 2026-11-30 📅 2026-11-24", false)?.kind).toBe("due");
  });
  test("a finished card sits on the day it was done", () => {
    expect(placeCard("Done 📅 2026-11-24 ✅ 2026-11-21", true)).toEqual({ kind: "done", from: "2026-11-21", to: "2026-11-21" });
    // Not finished: the done date is ignored.
    expect(placeCard("Done 📅 2026-11-24 ✅ 2026-11-21", false)?.kind).toBe("due");
  });
  test("no dates, no place", () => {
    expect(placeCard("Find a venue #party", false)).toBeNull();
  });
});

describe("days", () => {
  test("round trip", () => {
    expect(isoDay(dayNumber("2026-11-22"))).toBe("2026-11-22");
    expect(dayNumber("2026-12-01") - dayNumber("2026-11-30")).toBe(1);
  });
  test("weekday counts from Monday", () => {
    expect(weekday(dayNumber("2026-11-23"))).toBe(0); // a Monday
    expect(weekday(dayNumber("2026-11-22"))).toBe(6);
  });
});

describe("moveCardDates", () => {
  const day = (iso: string) => dayNumber(iso);
  test("a bar keeps its length", () => {
    const line = "Bake 🛫 2026-11-20 📅 2026-11-24";
    expect(moveCardDates(line, placeCard(line, false), day("2026-11-27"), "emoji")).toBe("Bake 🛫 2026-11-27 📅 2026-12-01");
  });
  test("a mark moves its own date, in the format it's written in", () => {
    const line = "Call  [scheduled:: 2026-11-24]";
    expect(moveCardDates(line, placeCard(line, false), day("2026-11-26"), "emoji")).toBe("Call  [scheduled:: 2026-11-26]");
  });
  test("a card with no dates gets a due date", () => {
    expect(moveCardDates("Find a venue", null, day("2026-11-26"), "dataview")).toBe("Find a venue  [due:: 2026-11-26]");
    expect(moveCardDates("Find a venue", null, day("2026-11-26"), "emoji")).toBe("Find a venue 📅 2026-11-26");
  });
  test("a finished card keeps its dates", () => {
    const line = "Done ✅ 2026-11-21";
    expect(moveCardDates(line, placeCard(line, true), day("2026-11-26"), "emoji")).toBe(line);
  });
});

describe("columns", () => {
  const d = dayNumber;
  test("a week runs Monday to Sunday", () => {
    expect(bucketAt("week", d("2026-11-26"))).toEqual({ start: d("2026-11-23"), end: d("2026-11-29") });
  });
  test("a month runs from its first day to its last, over a new year too", () => {
    expect(bucketAt("month", d("2026-12-15"))).toEqual({ start: d("2026-12-01"), end: d("2026-12-31") });
    expect(bucketAt("month", d("2027-02-10"))).toEqual({ start: d("2027-02-01"), end: d("2027-02-28") });
  });
  test("a card dropped in another group keeps its place in it", () => {
    // Thursday 2026-11-26 into the week of Monday 2026-12-07: Thursday 2026-12-10.
    expect(isoDay(dayIn("week", d("2026-11-26"), bucketAt("week", d("2026-12-07"))))).toBe("2026-12-10");
    // The 31st into a 30-day month: its last day.
    expect(isoDay(dayIn("month", d("2026-12-31"), bucketAt("month", d("2026-11-01"))))).toBe("2026-11-30");
    expect(isoDay(dayIn("day", d("2026-12-31"), bucketAt("day", d("2026-11-05"))))).toBe("2026-11-05");
  });
  test("the column size suits how far the dates spread", () => {
    expect(unitFor(d("2026-11-20"), d("2026-11-25"))).toBe("day");
    expect(unitFor(d("2026-11-01"), d("2026-12-20"))).toBe("week");
    expect(unitFor(d("2026-11-01"), d("2027-04-01"))).toBe("month");
  });
});
