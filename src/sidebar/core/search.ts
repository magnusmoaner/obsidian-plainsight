import type { AttachmentFile } from "./attachments";
import type { TaskRow } from "./queries";
import { taskDetails } from "./task-details";
import type { Priority } from "./task-line";
import { isClosed, NoteSummary, TaskItem } from "./types";

/*
 * One query language for the list's Filter and for Search everywhere:
 *
 *   words  "exact phrase"  -exclude  -"excluded phrase"
 *   #tag  tag:x  -#tag              a tag, or one nested under it
 *   path:x  in:x  -path:x           anywhere in the note's path
 *   file:x                          in the note's name
 *   is:open|done|overdue|recurring|task|note|board|canvas|pinned
 *   due:today|tomorrow|week|overdue|none|any|2026-11-01|<2026-11-01|>2026-11-01
 *   scheduled:… (the same values)
 *   priority:highest|high|medium|normal|low|lowest
 *
 * Words and values are case-insensitive. A key this doesn't know
 * ("10:30", "http://…") is an ordinary word.
 */

export type DateFilter =
  | { kind: "today" | "tomorrow" | "week" | "overdue" | "none" | "any" }
  | { kind: "on" | "before" | "after"; date: string };

export type IsFilter = "open" | "done" | "overdue" | "recurring" | "task" | "note" | "board" | "canvas" | "pinned";

export interface SearchQuery {
  empty: boolean;
  words: string[];
  phrases: string[];
  excludes: string[];
  tags: string[];
  excludeTags: string[];
  paths: string[];
  excludePaths: string[];
  files: string[];
  is: IsFilter[];
  due: DateFilter | null;
  scheduled: DateFilter | null;
  priority: Priority | "normal" | null;
}

const IS: Record<string, IsFilter> = {
  open: "open",
  todo: "open",
  done: "done",
  completed: "done",
  overdue: "overdue",
  recurring: "recurring",
  repeating: "recurring",
  task: "task",
  tasks: "task",
  note: "note",
  notes: "note",
  board: "board",
  boards: "board",
  canvas: "canvas",
  canvases: "canvas",
  pinned: "pinned",
};

const PRIORITY: Record<string, Priority | "normal"> = {
  highest: "highest",
  high: "high",
  medium: "medium",
  normal: "normal",
  none: "normal",
  low: "low",
  lowest: "lowest",
};

const KEYS = new Set(["tag", "path", "in", "file", "is", "due", "scheduled", "priority"]);
const TOKEN = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi;

function parseDate(value: string): DateFilter | null {
  const v = value.toLowerCase();
  if (v === "today" || v === "tomorrow" || v === "week" || v === "overdue" || v === "none" || v === "any") {
    return { kind: v };
  }
  const m = /^([<>])?(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (!m) return null;
  return { kind: m[1] === "<" ? "before" : m[1] === ">" ? "after" : "on", date: m[2] };
}

export function parseQuery(input: string): SearchQuery {
  const q: SearchQuery = {
    empty: true,
    words: [],
    phrases: [],
    excludes: [],
    tags: [],
    excludeTags: [],
    paths: [],
    excludePaths: [],
    files: [],
    is: [],
    due: null,
    scheduled: null,
    priority: null,
  };
  for (const m of input.matchAll(TOKEN)) {
    const [raw, minus, rawKey, quoted, bare] = m;
    if (!raw.trim() || raw === "-") continue;
    const negate = minus === "-";
    const value = (quoted ?? bare ?? "").trim();
    const key = rawKey?.toLowerCase();
    const word = (text: string) => (negate ? q.excludes : q.words).push(text.toLowerCase());
    if (key && KEYS.has(key) && value) {
      const v = value.toLowerCase();
      if (key === "tag") (negate ? q.excludeTags : q.tags).push(v.replace(/^#/, ""));
      else if (key === "path" || key === "in") (negate ? q.excludePaths : q.paths).push(v);
      else if (key === "file") q.files.push(v);
      else if (key === "is" && IS[v]) q.is.push(IS[v]);
      else if ((key === "due" || key === "scheduled") && parseDate(v)) q[key] = parseDate(v);
      else if (key === "priority" && PRIORITY[v]) q.priority = PRIORITY[v];
      else word(raw.slice(negate ? 1 : 0));
      continue;
    }
    if (key) word(raw.slice(negate ? 1 : 0));
    else if (quoted !== undefined) {
      if (value) (negate ? q.excludes : q.phrases).push(value.toLowerCase());
    } else if (value.startsWith("#") && value.length > 1) {
      (negate ? q.excludeTags : q.tags).push(value.slice(1).toLowerCase());
    } else word(value);
  }
  q.empty =
    !q.words.length &&
    !q.phrases.length &&
    !q.excludes.length &&
    !q.tags.length &&
    !q.excludeTags.length &&
    !q.paths.length &&
    !q.excludePaths.length &&
    !q.files.length &&
    !q.is.length &&
    !q.due &&
    !q.scheduled &&
    !q.priority;
  return q;
}

// ---------- matching (the Filter) ----------

/** YYYY-MM-DD `days` after `iso`, in calendar terms. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const hasTag = (tags: string[], want: string) =>
  tags.some((tag) => {
    const t = tag.toLowerCase();
    return t === want || t.startsWith(`${want}/`);
  });

function textMatches(text: string, q: SearchQuery): boolean {
  return (
    q.words.every((w) => text.includes(w)) &&
    q.phrases.every((p) => text.includes(p)) &&
    !q.excludes.some((e) => text.includes(e))
  );
}

function dateMatches(date: string | null, filter: DateFilter | null, today: string, open: boolean): boolean {
  if (!filter) return true;
  switch (filter.kind) {
    case "none":
      return date === null;
    case "any":
      return date !== null;
    case "today":
      return date === today;
    case "tomorrow":
      return date === addDays(today, 1);
    case "week":
      return date !== null && date >= today && date <= addDays(today, 7);
    case "overdue":
      return date !== null && date < today && open;
    case "on":
      return date === filter.date;
    case "before":
      return date !== null && date < filter.date;
    case "after":
      return date !== null && date > filter.date;
  }
}

const TASK_IS: IsFilter[] = ["open", "done", "overdue", "recurring", "task"];

function hasTaskFilters(q: SearchQuery): boolean {
  return q.is.some((i) => TASK_IS.includes(i)) || !!q.due || !!q.scheduled || q.priority !== null;
}

function taskFiltersMatch(task: TaskItem, q: SearchQuery, today: string): boolean {
  const d = taskDetails(task.text);
  const closed = isClosed(task);
  const due = d.due ?? task.due;
  for (const is of q.is) {
    if (is === "open" && closed) return false;
    if (is === "done" && !closed) return false;
    if (is === "overdue" && (closed || !due || due >= today)) return false;
    if (is === "recurring" && !d.recurrence) return false;
  }
  if (!dateMatches(due, q.due, today, !closed)) return false;
  if (!dateMatches(d.scheduled, q.scheduled, today, !closed)) return false;
  return q.priority === null || (d.priority ?? "normal") === q.priority;
}

function placeMatches(note: NoteSummary, q: SearchQuery): boolean {
  const path = note.path.toLowerCase();
  const title = note.title.toLowerCase();
  if (!q.paths.every((p) => path.includes(p)) || q.excludePaths.some((p) => path.includes(p))) return false;
  if (!q.files.every((f) => title.includes(f))) return false;
  for (const is of q.is) {
    if (is === "note" && note.kind !== "note") return false;
    if (is === "board" && note.kind !== "board") return false;
    if (is === "canvas" && note.kind !== "canvas") return false;
    if (is === "pinned" && !note.pinned) return false;
  }
  return true;
}

/** The Filter on a note list. Task filters keep notes with a matching task. */
export function matchNote(note: NoteSummary, q: SearchQuery, today: string): boolean {
  if (q.empty) return true;
  if (!placeMatches(note, q)) return false;
  if (!q.tags.every((t) => hasTag(note.tags, t)) || q.excludeTags.some((t) => hasTag(note.tags, t))) return false;
  if (!textMatches(note.searchText, q)) return false;
  return !hasTaskFilters(q) || note.tasks.some((task) => taskFiltersMatch(task, q, today));
}

/** The Filter on task rows. Words match the task or its note's name; tags
 * the task's own or its note's. */
export function matchTask(row: TaskRow, q: SearchQuery, today: string): boolean {
  if (q.empty) return true;
  const { note, task } = row;
  if (!placeMatches(note, q)) return false;
  const tags = [...taskDetails(task.text).tags, ...note.tags];
  if (!q.tags.every((t) => hasTag(tags, t)) || q.excludeTags.some((t) => hasTag(tags, t))) return false;
  if (!textMatches(`${task.text} ${note.title}`.toLowerCase(), q)) return false;
  return taskFiltersMatch(task, q, today);
}

/** The Filter on attachments: name or extracted text (lower-cased). Tags and
 * note or task filters never match a file. */
export function matchAttachment(file: AttachmentFile, extracted: string, q: SearchQuery): boolean {
  if (q.empty) return true;
  if (q.tags.length || hasTaskFilters(q) || q.is.length) return false;
  const path = file.path.toLowerCase();
  if (!q.paths.every((p) => path.includes(p)) || q.excludePaths.some((p) => path.includes(p))) return false;
  const name = file.name.toLowerCase();
  if (!q.files.every((f) => name.includes(f))) return false;
  return textMatches(`${name} ${extracted}`, q);
}

/** The query without its words, phrases and exclusions: what's left to
 * check on results another engine (Omnisearch) found by their text. */
export function filtersOnly(q: SearchQuery): SearchQuery {
  const rest = { ...q, words: [], phrases: [], excludes: [] };
  rest.empty =
    !rest.tags.length &&
    !rest.excludeTags.length &&
    !rest.paths.length &&
    !rest.excludePaths.length &&
    !rest.files.length &&
    !rest.is.length &&
    !rest.due &&
    !rest.scheduled &&
    !rest.priority;
  return rest;
}

// ---------- ranking (Search everywhere) ----------

const searchTerms = (q: SearchQuery) => [...q.phrases, ...q.words];

/** How well a name matches the words typed: whole, from the start, all words. */
export function nameScore(name: string, q: SearchQuery): number {
  const terms = searchTerms(q);
  if (!terms.length) return 0;
  const n = name.toLowerCase();
  const full = terms.join(" ");
  if (n === full) return 30;
  if (n.startsWith(full)) return 20;
  const found = terms.filter((t) => n.includes(t)).length;
  return found === terms.length ? 12 : (4 * found) / terms.length;
}

function count(text: string, term: string, cap = 20): number {
  let n = 0;
  for (let at = text.indexOf(term); at !== -1 && n < cap; at = text.indexOf(term, at + term.length)) n++;
  return n;
}

/** Notes that match, best first: a name match outranks words in the text,
 * which are weighed BM25-style (rarer words count more, long notes less).
 * With no words, most recent first. */
export function rankNotes(notes: NoteSummary[], q: SearchQuery, today: string, limit = Infinity): NoteSummary[] {
  const hits = notes.filter((n) => matchNote(n, q, today));
  const terms = searchTerms(q);
  if (!terms.length) return hits.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  const total = notes.length || 1;
  const idf = terms.map((t) => {
    const df = notes.reduce((c, n) => c + (n.searchText.includes(t) ? 1 : 0), 0);
    return Math.log(1 + (total - df + 0.5) / (df + 0.5));
  });
  const avg = hits.reduce((s, n) => s + n.searchText.length, 0) / (hits.length || 1) || 1;
  const k1 = 1.2;
  const b = 0.75;
  const score = new Map<string, number>();
  for (const n of hits) {
    let s = nameScore(n.title, q);
    terms.forEach((t, i) => {
      const tf = count(n.searchText, t);
      s += (idf[i] * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * n.searchText.length) / avg));
    });
    score.set(n.path, s);
  }
  return hits
    .sort((a, b2) => score.get(b2.path)! - score.get(a.path)! || b2.mtime - a.mtime)
    .slice(0, limit);
}

/** Task rows that match: open before done, then most words in the task,
 * then soonest due. */
export function rankTasks(rows: TaskRow[], q: SearchQuery, today: string, limit = Infinity): TaskRow[] {
  const terms = searchTerms(q);
  const scored = rows
    .filter((r) => matchTask(r, q, today))
    .map((r) => {
      const d = taskDetails(r.task.text);
      const text = d.description.toLowerCase();
      return {
        row: r,
        closed: isClosed(r.task),
        words: terms.filter((t) => text.includes(t)).length,
        due: d.due ?? r.task.due ?? "9999-99-99",
      };
    });
  scored.sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      b.words - a.words ||
      (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) ||
      a.row.task.line - b.row.task.line
  );
  return scored.slice(0, limit).map((s) => s.row);
}

// ---------- hand-off and display ----------

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

/** The parts of a query Obsidian's own search understands, in its syntax.
 * Task filters have no equivalent there and are left out. */
export function toObsidianQuery(q: SearchQuery): string {
  return [
    ...q.words,
    ...q.phrases.map((p) => `"${p}"`),
    ...q.excludes.map((e) => `-${quote(e)}`),
    ...q.tags.map((t) => `tag:#${t}`),
    ...q.excludeTags.map((t) => `-tag:#${t}`),
    ...q.paths.map((p) => `path:${quote(p)}`),
    ...q.excludePaths.map((p) => `-path:${quote(p)}`),
    ...q.files.map((f) => `file:${quote(f)}`),
  ].join(" ");
}

/** Words, phrases and exclusions, in the syntax Omnisearch understands. */
export function toOmnisearchQuery(q: SearchQuery): string {
  return [...q.words, ...q.phrases.map((p) => `"${p}"`), ...q.excludes.map((e) => `-${quote(e)}`)].join(" ");
}

/**
 * The query as a Tasks plugin query block, in the wording its documentation
 * uses ("not done", "due before today", "priority is high", "tags include
 * #x", "description includes x", …), so a search can be saved in a note.
 * What Tasks can't express is noted in comment lines rather than dropped
 * silently.
 */
export function toTasksQuery(q: SearchQuery, input: string): string {
  const lines: string[] = [`# From Plainsight search: ${input.trim()}`];
  const kinds = q.is.filter((i) => i === "note" || i === "board" || i === "canvas" || i === "pinned");
  if (kinds.length) lines.push(`# Tasks has no filter for: ${kinds.map((k) => `is:${k}`).join(" ")}`);
  if (q.is.includes("done")) lines.push("done");
  else if (q.is.includes("open") || q.is.includes("overdue")) lines.push("not done");
  if (q.is.includes("overdue")) lines.push("due before today");
  if (q.is.includes("recurring")) lines.push("is recurring");
  const dates = (field: "due" | "scheduled", filter: DateFilter | null) => {
    if (!filter) return;
    switch (filter.kind) {
      case "today":
      case "tomorrow":
        lines.push(`${field} on ${filter.kind}`);
        return;
      case "week":
        lines.push(`# ${field}:week means the next 7 days`, `${field} on or after today`, `${field} on or before in 7 days`);
        return;
      case "overdue":
        lines.push("not done", `${field} before today`);
        return;
      case "none":
        lines.push(`no ${field} date`);
        return;
      case "any":
        lines.push(`has ${field} date`);
        return;
      default:
        lines.push(`${field} ${filter.kind} ${filter.date}`);
    }
  };
  dates("due", q.due);
  dates("scheduled", q.scheduled);
  if (q.priority) lines.push(`priority is ${q.priority === "normal" ? "none" : q.priority}`);
  lines.push(
    ...q.tags.map((t) => `tags include #${t}`),
    ...q.excludeTags.map((t) => `tags do not include #${t}`),
    ...q.paths.map((p) => `path includes ${p}`),
    ...q.excludePaths.map((p) => `path does not include ${p}`),
    ...q.files.map((f) => `filename includes ${f}`),
    ...[...q.words, ...q.phrases].map((w) => `description includes ${w}`),
    ...q.excludes.map((e) => `description does not include ${e}`)
  );
  return ["```tasks", ...new Set(lines), "```"].join("\n");
}

const FRONTMATTER = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * A short window of a note's text around the first word or phrase of the
 * query, with every match in it (start/end offsets) for highlighting. Null
 * when the query has no words or none occurs.
 */
export function excerpt(
  text: string,
  q: SearchQuery,
  width = 140
): { text: string; highlights: Array<[number, number]> } | null {
  const needles = searchTerms(q);
  if (!needles.length) return null;
  const body = text
    .replace(FRONTMATTER, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/[*_`]/g, "");
  const lower = body.toLowerCase();
  let at = -1;
  let hit = "";
  for (const n of needles) {
    const i = lower.indexOf(n);
    if (i !== -1 && (at === -1 || i < at)) {
      at = i;
      hit = n;
    }
  }
  if (at === -1) return null;
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(body.length, at + hit.length + Math.ceil((width * 2) / 3));
  const window = `${start > 0 ? "…" : ""}${body.slice(start, end).replace(/\s+/g, " ").trim()}${end < body.length ? "…" : ""}`;
  const low = window.toLowerCase();
  const highlights: Array<[number, number]> = [];
  for (const n of needles) {
    for (let i = low.indexOf(n); i !== -1; i = low.indexOf(n, i + n.length)) highlights.push([i, i + n.length]);
  }
  highlights.sort((a, b) => a[0] - b[0]);
  return { text: window, highlights };
}
