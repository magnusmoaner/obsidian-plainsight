import { inFolder, isClosed, NoteSummary, TaskItem } from "./types";

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
  templatesFolder: string | null = null
): TaskRow[] {
  const rows = notes
    .filter((note) => templatesFolder === null || !inFolder(note.folder, templatesFolder))
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
