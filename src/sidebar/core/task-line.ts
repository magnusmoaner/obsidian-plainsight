import { addDays } from "./queries";

/*
 * The quick-add task dialog's output: one line in the Tasks plugin's emoji
 * format, so Tasks reads it exactly as if its own dialog had written it.
 */

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

export const PRIORITIES: { value: Priority; label: string; emoji: string }[] = [
  { value: "highest", label: "Highest", emoji: "🔺" },
  { value: "high", label: "High", emoji: "⏫" },
  { value: "medium", label: "Medium", emoji: "🔼" },
  { value: "low", label: "Low", emoji: "🔽" },
  { value: "lowest", label: "Lowest", emoji: "⏬" },
];

/** What the Tasks plugin's own dialog would add, from its settings. */
export interface TaskLineOptions {
  /** Tasks' global filter (e.g. "#task"); lines without it aren't tasks to Tasks. */
  globalFilter?: string;
  /** Today's date (YYYY-MM-DD) when Tasks' "set created date" is on. */
  created?: string;
}

/** Repeat rules offered in the dialog; all are valid Tasks recurrence text. */
export const RECURRENCES = ["every day", "every weekday", "every week", "every month", "every year"];

export interface NewTask extends TaskLineOptions {
  text: string;
  /** YYYY-MM-DD */
  due?: string;
  scheduled?: string;
  start?: string;
  priority?: Priority;
  /** One of RECURRENCES. */
  recurrence?: string;
  /** Repeat from the completion date instead of the original date. */
  whenDone?: boolean;
}

/**
 * The task line, or null if there's no text, a date isn't YYYY-MM-DD, the
 * repeat rule isn't one we offer, or a repeating task has no date to repeat.
 */
export function buildTaskLine(task: NewTask): string | null {
  // A newline would turn one appended task into several lines.
  const text = task.text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const dates = [task.due, task.scheduled, task.start, task.created];
  if (dates.some((d) => d !== undefined && d !== "" && !date.test(d))) return null;
  if (task.recurrence) {
    if (!RECURRENCES.includes(task.recurrence)) return null;
    if (!task.due && !task.scheduled && !task.start) return null;
  }
  const filter = task.globalFilter?.trim();
  // Tasks' own order: description, priority, recurrence, created, start, scheduled, due.
  const parts = [filter && !text.split(" ").includes(filter) ? `- [ ] ${filter} ${text}` : `- [ ] ${text}`];
  const priority = PRIORITIES.find((p) => p.value === task.priority);
  if (priority) parts.push(priority.emoji);
  if (task.recurrence) parts.push(`🔁 ${task.recurrence}${task.whenDone ? " when done" : ""}`);
  if (task.created) parts.push(`➕ ${task.created}`);
  if (task.start) parts.push(`🛫 ${task.start}`);
  if (task.scheduled) parts.push(`⏳ ${task.scheduled}`);
  if (task.due) parts.push(`📅 ${task.due}`);
  return parts.join(" ");
}

/** Quick dates relative to `today` (YYYY-MM-DD); next week is the coming Monday. */
export function duePresets(today: string): { label: string; date: string }[] {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const toMonday = ((8 - weekday) % 7) || 7;
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(today, toMonday) },
  ];
}
