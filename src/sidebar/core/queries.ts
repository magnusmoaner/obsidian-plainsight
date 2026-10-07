import { inFolder, isClosed, NoteSummary, TaskItem } from "./types";

export type Place =
  | { kind: "notes" }
  | { kind: "notebook"; folder: string }
  | { kind: "tag"; tag: string }
  | { kind: "tasks" }
  | { kind: "templates" };

export type SortKey = "modified" | "created" | "title";

export interface QueryOptions {
  sort: SortKey;
  search: string;
  templatesFolder: string | null;
}

export interface NoteGroup {
  label: string;
  notes: NoteSummary[];
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
export function groupNotes(sorted: NoteSummary[], sort: SortKey): NoteGroup[] {
  const groups: NoteGroup[] = [];
  const pinned = sorted.filter((n) => n.pinned);
  const rest = sorted.filter((n) => !n.pinned);
  if (pinned.length) groups.push({ label: "Pinned Notes", notes: pinned });
  if (!rest.length) return groups;
  if (sort === "title") {
    groups.push({ label: "", notes: rest });
    return groups;
  }
  let current: NoteGroup | null = null;
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

/** Notebooks: folders holding notes (directly or below), templates excluded. */
export function folderRows(
  folders: string[],
  notes: NoteSummary[],
  templatesFolder: string | null
): TreeRow[] {
  const counts = new Map<string, number>();
  const countUnder = (folder: string) => notes.filter((n) => inFolder(n.folder, folder)).length;
  for (const folder of folders) {
    if (!folder || (templatesFolder && inFolder(folder, templatesFolder))) continue;
    const count = countUnder(folder);
    if (count > 0) counts.set(folder, count);
  }
  // Keep every ancestor of a kept folder, or its children would be orphaned.
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
