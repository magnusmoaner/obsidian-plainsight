import { inFolder, isClosed, NoteKind, NoteSummary, TaskItem } from "./types";

export type Place =
  | { kind: "notes" }
  | { kind: "notebook"; folder: string }
  | { kind: "tag"; tag: string }
  | { kind: "tasks" }
  | { kind: "templates" }
  | { kind: "attachments" };

export type SortKey = "modified" | "created" | "title";

export interface QueryOptions {
  sort: SortKey;
  search: string;
  templatesFolder: string | null;
  /** Only this kind (note / board / canvas); undefined or null = all. */
  kind?: NoteKind | null;
}

export interface NoteGroup<T = NoteSummary> {
  label: string;
  notes: T[];
}

/** What month grouping needs; NoteSummary and AttachmentFile both fit. */
interface Dated {
  mtime: number;
  ctime: number;
  pinned?: boolean;
}

function inPlace(note: NoteSummary, place: Place, templates: string | null): boolean {
  const isTemplate = templates !== null && inFolder(note.folder, templates);
  switch (place.kind) {
    case "notes":
      return !isTemplate;
    case "notebook":
      return inFolder(note.folder, place.folder);
    case "tag": {
      const tag = place.tag.toLowerCase();
      return note.tags.some((t) => {
        const lower = t.toLowerCase();
        return lower === tag || lower.startsWith(`${tag}/`);
      });
    }
    case "templates":
      return isTemplate;
    case "tasks":
      return note.tasks.length > 0;
    case "attachments":
      return false; // files, not notes: listed by attachmentsFor
  }
}

function matchesSearch(note: NoteSummary, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => note.searchText.includes(term));
}

const byTitle = (a: NoteSummary, b: NoteSummary) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

function comparator(sort: SortKey) {
  return (a: NoteSummary, b: NoteSummary): number => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "title") return byTitle(a, b);
    const key = sort === "created" ? "ctime" : "mtime";
    return b[key] - a[key] || byTitle(a, b);
  };
}

export function notesFor(notes: NoteSummary[], place: Place, opts: QueryOptions): NoteSummary[] {
  return notes
    .filter((n) => !opts.kind || n.kind === opts.kind)
    .filter((n) => inPlace(n, place, opts.templatesFolder) && matchesSearch(n, opts.search))
    .sort(comparator(opts.sort));
}

/** Pinned notes first, then (for date sorts) one group per month. */
export function groupNotes<T extends Dated>(sorted: T[], sort: SortKey): NoteGroup<T>[] {
  const groups: NoteGroup<T>[] = [];
  const pinned = sorted.filter((n) => n.pinned);
  const rest = sorted.filter((n) => !n.pinned);
  if (pinned.length) groups.push({ label: "Pinned Notes", notes: pinned });
  if (!rest.length) return groups;
  if (sort === "title") {
    groups.push({ label: "", notes: rest });
    return groups;
  }
  let current: NoteGroup<T> | null = null;
  for (const n of rest) {
    const label = new Date(sort === "created" ? n.ctime : n.mtime).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (!current || current.label !== label) {
      current = { label, notes: [] };
      groups.push(current);
    }
    current.notes.push(n);
  }
  return groups;
}

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  count: number;
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * Depth-first rows from a path → count map, children sorted by name. Walking
 * parent-to-children (rather than sorting full paths) keeps "A" → "A/B" →
 * "A B" in order; ICU collation largely ignores the "/" and would interleave.
 */
function treeRows(counts: Map<string, number>): TreeRow[] {
  const children = new Map<string, string[]>();
  for (const path of counts.keys()) {
    const parent = parentOf(path);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(path);
  }
  const rows: TreeRow[] = [];
  const walk = (parent: string, depth: number) => {
    const kids = (children.get(parent) ?? []).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
    for (const path of kids) {
      rows.push({ path, name: path.slice(path.lastIndexOf("/") + 1), depth, count: counts.get(path)! });
      walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/**
 * Notebooks: every folder except templates and those `exclude` rejects
 * (attachment folders). Empty folders are included — a brand-new notebook
 * has no notes yet — and counts include notes in subfolders.
 */
export function folderRows(
  folders: string[],
  notes: NoteSummary[],
  templatesFolder: string | null,
  exclude: (folder: string) => boolean = () => false
): TreeRow[] {
  const counts = new Map<string, number>();
  const countUnder = (folder: string) => notes.filter((n) => inFolder(n.folder, folder)).length;
  for (const folder of folders) {
    if (!folder || (templatesFolder && inFolder(folder, templatesFolder)) || exclude(folder)) continue;
    counts.set(folder, countUnder(folder));
  }
  // An excluded parent (an attachment folder holding a real notebook) would
  // orphan its children; keep the ancestors of every kept folder.
  for (const folder of [...counts.keys()]) {
    for (let p = parentOf(folder); p; p = parentOf(p)) {
      if (!counts.has(p)) counts.set(p, countUnder(p));
    }
  }
  return treeRows(counts);
}

/** Nested tags, lower-cased so `Work/x` and `work/y` share a parent. */
export function tagRows(notes: NoteSummary[]): TreeRow[] {
  const members = new Map<string, Set<string>>();
  for (const n of notes) {
    for (const tag of n.tags) {
      const parts = tag.toLowerCase().split("/");
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join("/");
        if (!members.has(path)) members.set(path, new Set());
        members.get(path)!.add(n.path);
      }
    }
  }
  return treeRows(new Map([...members].map(([path, set]) => [path, set.size])));
}

export type TaskFilter = "open" | "overdue" | "done";

export interface TaskRow {
  note: NoteSummary;
  task: TaskItem;
}

/**
 * `today` is a local YYYY-MM-DD string, so comparison is plain string order.
 * Templates are excluded: their placeholder `- [ ]` lines aren't real tasks,
 * and ticking one would edit the template.
 */
export function taskRows(
  notes: NoteSummary[],
  filter: TaskFilter,
  today: string,
  templatesFolder: string | null = null,
  /** Kanban cards are `- [ ]` lines too, but they're board items, not to-dos. */
  includeBoardCards = false
): TaskRow[] {
  const rows = notes
    .filter((note) => templatesFolder === null || !inFolder(note.folder, templatesFolder))
    .filter((note) => includeBoardCards || note.kind !== "board")
    .flatMap((note) => note.tasks.map((task) => ({ note, task })));
  const keep = rows.filter(({ task }) => {
    if (filter === "done") return isClosed(task);
    if (isClosed(task)) return false;
    return filter === "open" || (task.due !== null && task.due < today);
  });
  return keep.sort((a, b) => {
    if (filter !== "done") {
      const dueA = a.task.due ?? "9999-99-99";
      const dueB = b.task.due ?? "9999-99-99";
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    }
    return b.note.mtime - a.note.mtime || a.task.line - b.task.line;
  });
}

export function taskProgress(note: NoteSummary): { closed: number; total: number } {
  return { closed: note.tasks.filter(isClosed).length, total: note.tasks.length };
}

export interface VisibleRow extends TreeRow {
  /** Has children in the full tree, so it gets a collapse chevron. */
  hasChildren: boolean;
  collapsed: boolean;
}

/**
 * The rows still visible when the paths in `collapsed` are folded: a
 * collapsed row stays visible, its descendants don't. Relies on treeRows'
 * depth-first order, where descendants immediately follow their parent.
 */
export function visibleRows(rows: TreeRow[], collapsed: ReadonlySet<string>): VisibleRow[] {
  const out: VisibleRow[] = [];
  let hideBelow = Infinity;
  rows.forEach((row, i) => {
    if (row.depth > hideBelow) return;
    hideBelow = Infinity;
    const hasChildren = (rows[i + 1]?.depth ?? -1) > row.depth;
    const isCollapsed = hasChildren && collapsed.has(row.path);
    if (isCollapsed) hideBelow = row.depth;
    out.push({ ...row, hasChildren, collapsed: isCollapsed });
  });
  return out;
}

/**
 * Narrow task rows by search text (every word must appear in the task text
 * or its note's title) and, optionally, to one note.
 */
export function filterTaskRows(rows: TaskRow[], search: string, notePath: string | null): TaskRow[] {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ note, task }) => {
    if (notePath !== null && note.path !== notePath) return false;
    if (!terms.length) return true;
    const text = `${task.text} ${note.title}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/** The notes behind a set of task rows, with how many rows each has, most first. */
export function notesOfTaskRows(rows: TaskRow[]): Array<{ note: NoteSummary; count: number }> {
  const counts = new Map<string, { note: NoteSummary; count: number }>();
  for (const { note } of rows) {
    const entry = counts.get(note.path);
    if (entry) entry.count++;
    else counts.set(note.path, { note, count: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.note.title.localeCompare(b.note.title, undefined, { numeric: true })
  );
}

export type TaskGrouping = "due" | "folder" | "note" | "board" | "none";

export interface TaskGroup {
  label: string;
  rows: TaskRow[];
}

/** YYYY-MM-DD `days` after `iso`, in calendar terms (no time zones involved). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

const DUE_ORDER = ["Overdue", "Today", "Tomorrow", "Next 7 days", "Later", "No due date"];
const DONE_ORDER = ["Done today", "Done yesterday", "Done in the last 7 days", "Done earlier", "No completion date"];

function dueLabel(due: string | null, today: string): string {
  if (!due) return "No due date";
  if (due < today) return "Overdue";
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  if (due <= addDays(today, 7)) return "Next 7 days";
  return "Later";
}

/** Finished work groups by when it was finished; "Overdue" would be wrong. */
function doneLabel(done: string | null, today: string): string {
  if (!done) return "No completion date";
  if (done === today) return "Done today";
  if (done === addDays(today, -1)) return "Done yesterday";
  if (done >= addDays(today, -7)) return "Done in the last 7 days";
  return "Done earlier";
}

interface Bucket {
  label: string;
  /** Sort keys, compared in order. */
  order: Array<number | string>;
  rows: TaskRow[];
}

const byKeys = (a: Bucket, b: Bucket): number => {
  for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) {
    const x = a.order[i];
    const y = b.order[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
  }
  return 0;
};

/**
 * Group already-sorted task rows, keeping row order within each group.
 * Groups are keyed by identity (note path, board + list), never by label,
 * so two notes with the same name stay separate; their labels then carry
 * the folder.
 * - due: Overdue … No due date for open tasks; completed tasks group by
 *   their ✅ date instead (Done today … Done earlier)
 * - folder: alphabetical ("Vault root" for the top level)
 * - note: one group per note, in first-appearance order
 * - board: "Board › List" for Kanban cards, boards alphabetically and lists
 *   in the board's own order; rows from ordinary notes are dropped
 * - none: a single unlabelled group
 */
export function groupTaskRows(rows: TaskRow[], by: TaskGrouping, today: string): TaskGroup[] {
  if (by === "none") return rows.length ? [{ label: "", rows }] : [];
  const buckets = new Map<string, Bucket>();
  const add = (key: string, label: string, order: Bucket["order"], row: TaskRow) => {
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { label, order, rows: [row] });
  };
  let seen = 0;
  for (const row of rows) {
    const { note, task } = row;
    if (by === "due") {
      const closed = isClosed(task);
      const label = closed ? doneLabel(task.done, today) : dueLabel(task.due, today);
      // Open buckets before done buckets (only one kind shows per tab anyway).
      const order = closed ? DUE_ORDER.length + DONE_ORDER.indexOf(label) : DUE_ORDER.indexOf(label);
      add(label, label, [order], row);
    } else if (by === "folder") {
      const label = note.folder || "Vault root";
      add(note.folder, label, [note.folder === "" ? 0 : 1, label], row);
    } else if (by === "note") {
      add(note.path, note.title, [seen++], row);
    } else if (note.kind === "board") {
      const lane = task.section ? note.columns.indexOf(task.section) : -1;
      const label = task.section ? `${note.title} › ${task.section}` : note.title;
      add(`${note.path}\u0000${task.section ?? ""}`, label, [note.title, note.path, lane === -1 ? 1e9 : lane], row);
    }
  }
  const out = [...buckets.values()].sort(byKeys);
  // Same label for different notes (Work/Roadmap, Home/Roadmap): add the folder.
  const counts = new Map<string, number>();
  for (const b of out) counts.set(b.label, (counts.get(b.label) ?? 0) + 1);
  return out.map((b) => {
    const folder = b.rows[0].note.folder;
    const clash = (by === "note" || by === "board") && (counts.get(b.label) ?? 0) > 1;
    return { label: clash ? `${b.label} (${folder || "Vault root"})` : b.label, rows: b.rows };
  });
}

export const TASK_GROUPINGS: TaskGrouping[] = ["due", "folder", "note", "board", "none"];

export type NoteGrouping = "date" | "folder" | "kind" | "none";
export const NOTE_GROUPINGS: NoteGrouping[] = ["date", "folder", "kind", "none"];

const KIND_LABELS: Record<NoteKind, string> = { note: "Notes", board: "Kanban boards", canvas: "Canvases" };
const KIND_ORDER: NoteKind[] = ["note", "board", "canvas"];

/** How many of `notes` there are of each kind, for the filter chips. */
export function kindCounts(notes: NoteSummary[]): Record<NoteKind, number> {
  const counts: Record<NoteKind, number> = { note: 0, board: 0, canvas: 0 };
  for (const n of notes) counts[n.kind]++;
  return counts;
}

/**
 * Group sorted notes for the list. Pinned notes always come first, in their
 * own group; the rest by month (date — no months under a title sort), by
 * folder (vault root first, then alphabetical), by kind (notes, boards,
 * canvases) or not at all. Order within a group is kept.
 */
export function groupNotesBy(sorted: NoteSummary[], sort: SortKey, by: NoteGrouping): NoteGroup[] {
  if (by === "date") return groupNotes(sorted, sort);
  const groups: NoteGroup[] = [];
  const pinned = sorted.filter((n) => n.pinned);
  const rest = sorted.filter((n) => !n.pinned);
  if (pinned.length) groups.push({ label: "Pinned Notes", notes: pinned });
  if (!rest.length) return groups;
  if (by === "none") {
    groups.push({ label: "", notes: rest });
    return groups;
  }
  const buckets = new Map<string, NoteSummary[]>();
  for (const n of rest) {
    const key = by === "folder" ? n.folder : n.kind;
    const list = buckets.get(key);
    if (list) list.push(n);
    else buckets.set(key, [n]);
  }
  const keys = [...buckets.keys()];
  if (by === "folder") {
    keys.sort((a, b) =>
      a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  } else {
    keys.sort((a, b) => KIND_ORDER.indexOf(a as NoteKind) - KIND_ORDER.indexOf(b as NoteKind));
  }
  for (const key of keys) {
    const label = by === "folder" ? key || "Vault root" : KIND_LABELS[key as NoteKind];
    groups.push({ label, notes: buckets.get(key)! });
  }
  return groups;
}
