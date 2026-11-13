import { readFrontmatter } from "./frontmatter";
import { matchTaskLine } from "./tasks";

/*
 * Moving a task from one place to another, as text. A task is its line and
 * the lines indented under it (subtasks, notes). It's only ever taken from
 * a note whose line is still the task that was shown; otherwise nothing is
 * written, as when a task is ticked.
 */

/** A task as the list showed it: where it was, and what it said. */
export interface TaskRef {
  line: number;
  status: string;
  text: string;
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])\s/;

/** One past the last line of the task that starts on `line`: its indented lines go with it. */
function blockEnd(lines: string[], line: number): number {
  const own = indentOf(lines[line]).length;
  let end = line + 1;
  while (end < lines.length && lines[end].trim() !== "" && indentOf(lines[end]).length > own) end++;
  return end;
}

/** The task's lines with its own indent taken off, so they can be placed at any depth. */
function outdent(block: string[]): string[] {
  const own = indentOf(block[0]).length;
  return block.map((l) => l.slice(Math.min(own, indentOf(l).length)));
}

function isStale(lines: string[], ref: TaskRef): boolean {
  const now = lines[ref.line] === undefined ? null : matchTaskLine(lines[ref.line]);
  return !now || now.status !== ref.status || now.text !== ref.text;
}

const split = (text: string) => ({ lines: text.split(/\r?\n/), eol: text.includes("\r\n") ? "\r\n" : "\n" });

/**
 * Take the task out of a note: the note without it, and the task's lines
 * (outdented). Null if the line is no longer that task.
 */
export function takeTask(text: string, ref: TaskRef): { text: string; block: string[] } | null {
  const { lines, eol } = split(text);
  if (isStale(lines, ref)) return null;
  const end = blockEnd(lines, ref.line);
  const block = outdent(lines.slice(ref.line, end));
  lines.splice(ref.line, end - ref.line);
  return { text: lines.join(eol), block };
}

/**
 * Where a block dropped before line `before` (0-based; lines.length is the
 * end) should really go, and at what indent: never inside the properties at
 * the top, and at the depth of the list item it lands beside.
 */
export function landing(lines: string[], before: number): { before: number; indent: string } {
  let at = Math.max(0, Math.min(before, lines.length));
  const fm = readFrontmatter(lines.join("\n"));
  if (fm) at = Math.max(at, fm.lines.length + 2);
  const beside = [lines[at - 1], lines[at]].find((l) => l !== undefined && LIST_ITEM.test(l));
  return { before: Math.min(at, lines.length), indent: beside ? indentOf(beside) : "" };
}

/** Put a task's lines into a note, before line `before`. */
export function placeTask(text: string, before: number, block: string[]): string {
  const { lines, eol } = split(text);
  const { before: at, indent } = landing(lines, before);
  lines.splice(at, 0, ...block.map((l) => indent + l));
  return lines.join(eol);
}

/** Put a task's lines at the end of a note, on lines of their own. */
export function appendTask(text: string, block: string[]): string {
  const { eol } = split(text);
  const body = text.replace(/\s*$/, "");
  return `${body}${body ? eol : ""}${block.join(eol)}${eol}`;
}

/**
 * Move a task within one note, to before line `before` as the note is now.
 * Null if the line is no longer that task; the same text if it's dropped on
 * itself.
 */
export function moveTask(text: string, ref: TaskRef, before: number): string | null {
  const { lines, eol } = split(text);
  if (isStale(lines, ref)) return null;
  const end = blockEnd(lines, ref.line);
  const { before: at } = landing(lines, before);
  if (at >= ref.line && at <= end) return text;
  const taken = takeTask(text, ref)!;
  return placeTask(taken.text, at > ref.line ? at - (end - ref.line) : at, taken.block).replace(/\r?\n/g, eol);
}

/** A task's lines as a board card: its checkbox character, and its text with the lines under it. */
export function taskAsCard(block: string[]): { check: string; body: string } {
  const first = matchTaskLine(block[0]);
  // The lines under a task sit one step in; a card's other lines don't.
  const rest = block.slice(1).map((l) => l.replace(/^( {1,4}|\t)/, ""));
  return { check: first?.status ?? " ", body: [first?.text ?? block[0].trim(), ...rest].join("\n") };
}
