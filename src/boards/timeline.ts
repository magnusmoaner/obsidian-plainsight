/*
 * A board's cards on a timeline: where each one sits, read from its Tasks
 * fields, and how moving it on the timeline changes them.
 */

import { taskDetails } from "../sidebar/core/task-details";
import { setTaskField, TaskFormat } from "../sidebar/core/task-fields";

/**
 * How a card sits on the timeline: a bar from its start to its due (or
 * scheduled) date, or a mark on one day for its due, scheduled, start or
 * done date.
 */
export interface Placement {
  kind: "bar" | "due" | "scheduled" | "start" | "done";
  /** First and last day, YYYY-MM-DD; the same day for all but a bar. */
  from: string;
  to: string;
  /** The field a bar ends on. */
  end?: "due" | "scheduled";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (date: string | null): string | null => (date && ISO.test(date) ? date : null);

/** Where a card goes, from its first line; null for a card with no dates. A done or cancelled card goes on the day it was finished, if that's written. */
export function placeCard(firstLine: string, finished: boolean): Placement | null {
  const d = taskDetails(firstLine);
  const closed = valid(d.done) ?? valid(d.cancelled);
  if (finished && closed) return { kind: "done", from: closed, to: closed };
  const start = valid(d.start);
  const due = valid(d.due);
  const scheduled = valid(d.scheduled);
  const end = due ?? scheduled;
  if (start && end && start <= end) return { kind: "bar", from: start, to: end, end: due ? "due" : "scheduled" };
  if (due) return { kind: "due", from: due, to: due };
  if (scheduled) return { kind: "scheduled", from: scheduled, to: scheduled };
  if (start) return { kind: "start", from: start, to: start };
  return null;
}

/** Days since 1970-01-01 for a YYYY-MM-DD date, counted in whole days whatever the time zone. */
export const dayNumber = (iso: string): number => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
/** The YYYY-MM-DD date of a day number. */
export const isoDay = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);
/** 0 for Monday … 6 for Sunday. */
export const weekday = (day: number): number => (day + 3) % 7;

/** The day a card is grouped on: its due date when it has one, else its first date. */
export const timelineDay = (place: Placement): string => (place.end === "due" ? place.to : place.from);

/**
 * A card's first line after it's dropped on `day` (a day number) on the
 * timeline: that becomes its due date, and its other dates stay. A finished
 * card keeps its dates.
 */
export function moveCardDates(firstLine: string, place: Placement | null, day: number, format: TaskFormat): string {
  return place?.kind === "done" ? firstLine : setTaskField(firstLine, "due", isoDay(day), format);
}

/** A group of the timeline: a day, a week (Monday to Sunday), a calendar month or a year. */
export type Unit = "day" | "week" | "month" | "year";

/** The group of `unit` that `day` falls in, as its first and last day numbers. */
export function bucketAt(unit: Unit, day: number): { start: number; end: number } {
  if (unit === "day") return { start: day, end: day };
  if (unit === "week") {
    const start = day - weekday(day);
    return { start, end: start + 6 };
  }
  const iso = isoDay(day);
  const y = +iso.slice(0, 4);
  if (unit === "year") return { start: dayNumber(`${y}-01-01`), end: dayNumber(`${y + 1}-01-01`) - 1 };
  const m = +iso.slice(5, 7);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: dayNumber(`${iso.slice(0, 7)}-01`), end: dayNumber(next) - 1 };
}

/** The group size a board's dates read best in: days for a week or so, weeks for a few months, months beyond. */
export function unitFor(from: number, to: number): Unit {
  const days = to - from + 1;
  return days <= 7 ? "day" : days <= 84 ? "week" : "month";
}
