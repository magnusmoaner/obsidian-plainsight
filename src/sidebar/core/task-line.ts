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

export interface NewTask {
  text: string;
  /** YYYY-MM-DD */
  due?: string;
  priority?: Priority;
}

/** The task line, or null if there's no text or the date isn't YYYY-MM-DD. */
export function buildTaskLine(task: NewTask): string | null {
  // A newline would turn one appended task into several lines.
  const text = task.text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (task.due && !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) return null;
  const parts = [`- [ ] ${text}`];
  const priority = PRIORITIES.find((p) => p.value === task.priority);
  if (priority) parts.push(priority.emoji);
  if (task.due) parts.push(`📅 ${task.due}`);
  return parts.join(" ");
}

/** Quick due dates relative to `today` (YYYY-MM-DD); next week is the coming Monday. */
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
