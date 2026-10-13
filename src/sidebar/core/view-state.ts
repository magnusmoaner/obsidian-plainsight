import { NOTE_GROUPINGS, NoteGrouping, TASK_GROUPINGS, TaskFilter, TaskGrouping } from "./queries";

export type KindFilter = "all" | "note" | "board" | "canvas";
const KIND_FILTERS: KindFilter[] = ["all", "note", "board", "canvas"];
const TASK_FILTERS: TaskFilter[] = ["open", "overdue", "done"];

/**
 * Sidebar state that belongs to one device, not to the vault: how wide the
 * places column is, what's folded, and how lists are grouped and filtered.
 * A phone and a desktop rarely want the same, and keeping it out of
 * data.json means a sync service never carries one device's folds to another.
 */
export interface ViewState {
  /** Width of the places column, in px. */
  navWidth: number;
  /** Collapsed nav sections and tree nodes, e.g. "section:tags", "notebook:Inbox". */
  collapsed: string[];
  /** How the Tasks page groups rows. */
  taskGroupBy: TaskGrouping;
  /** Which tasks the Tasks page shows: open, overdue or done. */
  taskFilter: TaskFilter;
  /** Note lists: which kind to show. */
  noteKindFilter: KindFilter;
  /** How note lists group cards. */
  noteGroupBy: NoteGrouping;
}

/** What the column divider allows. */
export const NAV_WIDTH = { min: 140, max: 360 };

export const DEFAULT_VIEW_STATE: ViewState = {
  navWidth: 200,
  collapsed: [],
  taskGroupBy: "due",
  taskFilter: "open",
  noteKindFilter: "all",
  noteGroupBy: "date",
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Stored view state, field by field: anything missing or malformed falls
 * back to its default without affecting the other fields. */
export function parseViewState(raw: unknown): ViewState {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const width = typeof data.navWidth === "number" && Number.isFinite(data.navWidth) ? data.navWidth : null;
  const collapsed = Array.isArray(data.collapsed)
    ? [...new Set(data.collapsed.filter((key): key is string => typeof key === "string"))]
    : [];
  return {
    navWidth:
      width === null
        ? DEFAULT_VIEW_STATE.navWidth
        : Math.round(Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, width))),
    collapsed,
    taskGroupBy: oneOf(data.taskGroupBy, TASK_GROUPINGS, DEFAULT_VIEW_STATE.taskGroupBy),
    taskFilter: oneOf(data.taskFilter, TASK_FILTERS, DEFAULT_VIEW_STATE.taskFilter),
    noteKindFilter: oneOf(data.noteKindFilter, KIND_FILTERS, DEFAULT_VIEW_STATE.noteKindFilter),
    noteGroupBy: oneOf(data.noteGroupBy, NOTE_GROUPINGS, DEFAULT_VIEW_STATE.noteGroupBy),
  };
}

/** Where earlier versions kept fields in the plugin's data.json. */
const LEGACY_KEYS: Partial<Record<keyof ViewState, string>> = {
  navWidth: "sidebarNavWidth",
  collapsed: "sidebarCollapsed",
  taskGroupBy: "taskGroupBy",
  noteKindFilter: "noteKindFilter",
  noteGroupBy: "noteGroupBy",
};

export const LEGACY_VIEW_KEYS: readonly string[] = Object.values(LEGACY_KEYS) as string[];

/** View state an earlier version saved in data.json, keyed by field, or
 * null if there's none. Validate it with parseViewState before use. */
export function legacyViewState(data: Record<string, unknown>): Record<string, unknown> | null {
  const found: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(LEGACY_KEYS)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) found[field] = data[key];
  }
  return Object.keys(found).length ? found : null;
}
