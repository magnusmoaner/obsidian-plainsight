import { TaskItem } from "./types";

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s?)(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
// A date field in either of Tasks' formats: 📅 2026-11-25 or [due:: 2026-11-25].
const date = (emoji: string, key: string) => new RegExp(`${emoji}\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})|[[(] *${key}:: *(\\d{4}-\\d{2}-\\d{2}) *[\\])]`, "u");
const DUE = date("📅", "due");
const DONE = date("✅", "completion");
const dateIn = (re: RegExp, text: string) => {
  const m = re.exec(text);
  return m ? m[1] ?? m[2] : null;
};
const FENCE = /^\s*(```|~~~)/;

export function parseTasks(text: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  let inFence = false;
  let section: string | null = null;
  // The list items the line being read sits under, outermost first.
  const above: Array<{ indent: number; text: string }> = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence || !line.trim()) return;
    const indent = /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;
    while (above.length && above[above.length - 1].indent >= indent) above.pop();
    // CommonMark: trailing #s close the heading only after whitespace, so
    // "## C#" is "C#" while "## Todo ##" is "Todo".
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      return;
    }
    const match = TASK_LINE.exec(line);
    const item = match ? match[4].trim() : LIST_ITEM.exec(line)?.[1].trim();
    const under = above[above.length - 1]?.text;
    if (item !== undefined) above.push({ indent, text: item });
    if (!match) return;
    tasks.push({
      line: index,
      status: match[2],
      text: match[4].trim(),
      due: dateIn(DUE, match[4]),
      section,
      done: dateIn(DONE, match[4]),
      ...(under !== undefined && { under }),
    });
  });
  return tasks;
}

/** The status and text of a task line, or null if it isn't one. */
export function matchTaskLine(line: string): { status: string; text: string } | null {
  const match = TASK_LINE.exec(line.replace(/\r$/, ""));
  return match ? { status: match[2], text: match[4].trim() } : null;
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

/**
 * Column of the first character of a task's text — past indentation, list
 * marker and checkbox — so the caret lands on the task, not before "- [ ]".
 * 0 for a line that isn't a task.
 */
export function taskTextColumn(line: string): number {
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[.\]\s*)/.exec(line);
  return match ? match[1].length : 0;
}
