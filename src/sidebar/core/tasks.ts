import { TaskItem } from "./types";

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s?)(.*)$/;
const DUE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const FENCE = /^\s*(```|~~~)/;
// Tasks-plugin field markers. They always follow the description, so the
// text before the first one is the human-readable task.
const TASKS_FIELD = /[📅⏳🛫✅➕❌🔁⏫🔼🔽⏬🔺🆔⛔]/u;

export function parseTasks(text: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = TASK_LINE.exec(line);
    if (!match) return;
    tasks.push({
      line: index,
      status: match[2],
      text: match[4].trim(),
      due: DUE.exec(match[4])?.[1] ?? null,
    });
  });
  return tasks;
}

/** The status and text of a task line, or null if it isn't one. */
export function matchTaskLine(line: string): { status: string; text: string } | null {
  const match = TASK_LINE.exec(line.replace(/\r$/, ""));
  return match ? { status: match[2], text: match[4].trim() } : null;
}

export function taskDisplayText(text: string): string {
  return text.split(TASKS_FIELD)[0].trim();
}

/**
 * Fallback toggle when the Tasks plugin API is unavailable. Changes only
 * the status character; returns null if `line` is not a task.
 */
export function toggleTaskLine(line: string): string | null {
  const cr = line.endsWith("\r") ? "\r" : "";
  const body = cr ? line.slice(0, -1) : line;
  const match = TASK_LINE.exec(body);
  if (!match) return null;
  const next = match[2] === "x" || match[2] === "X" ? " " : "x";
  return `${match[1]}${next}${match[3]}${match[4]}${cr}`;
}
