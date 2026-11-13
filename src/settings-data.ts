import type { Place, TaskFilter } from "./sidebar/core/queries";
import { LEGACY_VIEW_KEYS } from "./sidebar/core/view-state";

/*
 * The plugin's settings as stored in data.json, without Obsidian: what they
 * are, their defaults, and how a stored file is read back. Per-device view
 * state lives in sidebar/core/view-state.ts instead.
 */

/** A search kept in the side menu: a list, and what was typed in its search field. */
export interface SavedSearch {
  /** What it's called in the side menu; the query itself until it's given a name. */
  name: string;
  place: Place;
  query: string;
  /** On Tasks: the tab (Open, Overdue or Done) it was saved on. */
  taskFilter?: TaskFilter;
}

const PLACE_KINDS = ["notes", "tasks", "boards", "daily", "templates", "attachments"];
const TASK_FILTERS = ["open", "overdue", "done"];

/** The saved searches in a stored file: those that are whole, in order; the rest are dropped. */
export function parseSavedSearches(raw: unknown): SavedSearch[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSearch[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const { name, place, query, taskFilter } = item as { name?: unknown; place?: Record<string, unknown>; query?: unknown; taskFilter?: unknown };
    if (typeof query !== "string" || !query.trim() || !place || typeof place !== "object") continue;
    let where: Place | null = null;
    if (typeof place.kind === "string" && PLACE_KINDS.includes(place.kind)) where = { kind: place.kind } as Place;
    else if (place.kind === "notebook" && typeof place.folder === "string") where = { kind: "notebook", folder: place.folder };
    else if (place.kind === "tag" && typeof place.tag === "string" && place.tag) where = { kind: "tag", tag: place.tag };
    if (!where) continue;
    const tab = where.kind === "tasks" && typeof taskFilter === "string" && TASK_FILTERS.includes(taskFilter) ? (taskFilter as TaskFilter) : undefined;
    const called = typeof name === "string" && name.trim() ? name.trim() : query.trim();
    out.push(tab ? { name: called, place: where, query, taskFilter: tab } : { name: called, place: where, query });
  }
  return out;
}

export interface WysiwygSettings {
  enabled: boolean;
  /** Force Source mode so this plugin is the only renderer. */
  takeOverRendering: boolean;
  /** Tasks in the sidebar: the Tasks page, the New task buttons, the done counts on cards. */
  tasks: boolean;
  /** Note that the sidebar's "+" on Tasks appends new tasks to; "" = ask. */
  defaultTaskNote: string;
  /** Boards at all: Plainsight's own, and the board plugins'. Off, a board is an ordinary note. */
  boards: boolean;
  /** Read the Kanban plugin's boards as boards. */
  kanbanBoards: boolean;
  /** Read the Task List Kanban plugin's boards as boards. */
  taskListBoards: boolean;
  /** The narrowest a list on a board gets before the board scrolls sideways, in px. */
  boardListMinWidth: number;
  /** A Boards row in the places column, below Tasks. */
  showBoardsRow: boolean;
  /** List board cards on the Tasks page (they're `- [ ]` lines too). */
  boardCardsInTasks: boolean;
  /** Page Preview when the mouse rests on a note card or a task. */
  hoverPreviews: boolean;
  /** The sidebar's list panel: a gap (and rounded corners) on each side. */
  listInsetTop: boolean;
  listInsetBottom: boolean;
  listInsetLeft: boolean;
  listInsetRight: boolean;
  /** The sidebar's action row (the Note button always shows with it), then
   * its round buttons; one that's off moves into the ⋯ menu. The Daily note
   * button shows only while the Daily notes core plugin is on. */
  showActionRow: boolean;
  showSearchButton: boolean;
  showDailyNoteButton: boolean;
  showNewFolderButton: boolean;
  showNewTaskButton: boolean;
  showMoreButton: boolean;
  /** Daily notes and Templates rows in the places column (each shows only
   * while its core plugin is on). */
  showDailyNotes: boolean;
  showTemplates: boolean;
  /** Searches kept in the side menu, at the end of the Bookmarks section. */
  savedSearches: SavedSearch[];
  /** Saved searches in the side menu, and the button that saves one. Off keeps what's saved. */
  showSavedSearches: boolean;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
  takeOverRendering: false,
  tasks: true,
  defaultTaskNote: "",
  boards: true,
  kanbanBoards: true,
  taskListBoards: true,
  boardListMinWidth: 190,
  showBoardsRow: true,
  boardCardsInTasks: false,
  hoverPreviews: true,
  listInsetTop: false,
  listInsetBottom: true,
  listInsetLeft: false,
  listInsetRight: false,
  showActionRow: true,
  showSearchButton: true,
  showDailyNoteButton: true,
  showNewFolderButton: true,
  showNewTaskButton: true,
  showMoreButton: true,
  showDailyNotes: true,
  showTemplates: true,
  savedSearches: [],
  showSavedSearches: true,
};

/** The range the settings offer for a list's narrowest width. */
export const LIST_MIN_WIDTH = { min: 150, max: 400, step: 10 };

/** The setting as a usable width: within the range, whatever the file holds. */
export function listMinWidth(settings: WysiwygSettings): number {
  const value = Number.isFinite(settings.boardListMinWidth) ? settings.boardListMinWidth : DEFAULT_SETTINGS.boardListMinWidth;
  return Math.min(LIST_MIN_WIDTH.max, Math.max(LIST_MIN_WIDTH.min, Math.round(value)));
}

const KNOWN = new Set<string>(Object.keys(DEFAULT_SETTINGS));

/** Settings that no longer exist: `sidebar` (the sidebar is always on),
 * `showNoteButton` (the Note button shows whenever the action row does),
 * and the menu commands', which moved to Plainsight Menu Commands and were
 * later retired. */
const RETIRED = ["sidebar", "showNoteButton", "writingToolsCommands", "writingTools", "menuCommands"];

/**
 * A stored data.json, field by field: a value of the wrong type falls back
 * to its default. Keys this version doesn't know are returned as `extra`
 * and written back unchanged, so saving here never drops something a newer
 * version on another device stored. View state that has moved to the device,
 * and settings that have been retired, are left out of both.
 */
export function parseSettings(raw: unknown): { settings: WysiwygSettings; extra: Record<string, unknown> } {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const settings = { ...DEFAULT_SETTINGS };
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN.has(key)) {
      const name = key as keyof WysiwygSettings;
      // A list is checked item by item; everything else by its type.
      if (name === "savedSearches") settings.savedSearches = parseSavedSearches(value);
      else if (typeof value === typeof DEFAULT_SETTINGS[name]) (settings as Record<string, unknown>)[name] = value;
    } else if (!LEGACY_VIEW_KEYS.includes(key) && !RETIRED.includes(key)) {
      extra[key] = value;
    }
  }
  return { settings, extra };
}

/** What to write to data.json. */
export function serializeSettings(settings: WysiwygSettings, extra: Record<string, unknown>): Record<string, unknown> {
  return { ...extra, ...settings };
}
