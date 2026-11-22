import { cardDisplay } from "../../boards/board";
import { taskFields } from "./task-fields";
import { extractSnippet } from "./snippet";
import { Priority } from "./task-line";

/**
 * A task line's details, in the Tasks plugin's emoji or Dataview format,
 * read for display and grouping only (nothing here writes).
 */
export interface TaskDetails {
  /** What the task says: without Tasks fields, or the tags shown as badges. */
  description: string;
  /** Every tag in the task, without "#", in order. */
  tags: string[];
  /** Tags taken off the start or end of the description, to show as badges. A
   * tag mid-sentence stays in the text: "Call #mom about it". */
  badgeTags: string[];
  priority: Priority | null;
  due: string | null;
  scheduled: string | null;
  start: string | null;
  done: string | null;
  cancelled: string | null;
  /** As written, e.g. "every week when done". */
  recurrence: string | null;
}

/** What `taskFields` reads from a task's text. */
export function taskDetails(text: string): TaskDetails {
  return taskFields(text).details;
}

/** "every week when done" → "Every week": how often, for labels. */
export function recurrenceLabel(rule: string): string {
  const base = rule.replace(/\s+when done\s*$/i, "").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Roughly how many days between repeats, to order recurrence groups. */
export function recurrenceDays(rule: string): number {
  const m = /every\s+(?:(\d+)\s+)?(day|weekday|week|month|quarter|year)s?\b/i.exec(rule);
  if (m) {
    const unit = { day: 1, weekday: 1.4, week: 7, month: 30, quarter: 91, year: 365 }[m[2].toLowerCase()] ?? 0;
    return unit * Number(m[1] ?? 1);
  }
  if (/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(rule)) return 7;
  return Number.POSITIVE_INFINITY;
}

/**
 * A board card's title alone, for its tile in the note list: without the
 * Kanban date and time, the Tasks plugin's details, Dataview fields, tags,
 * or Markdown and link syntax.
 */
export function cardTitle(text: string): string {
  const { body } = cardDisplay(text);
  // A [key:: value] field is data about the card, not part of its name.
  const line = body.split("\n")[0].replace(/[[(][^[\]()]*::[^[\]()]*[\])]/g, "");
  const title = extractSnippet(taskDetails(line).description);
  return title.replace(/(^|\s)#[^\s#]+/g, "").replace(/\s+/g, " ").trim() || "Untitled";
}
