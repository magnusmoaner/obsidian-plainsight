import { WRITING_TOOLS } from "./menu-items";
import { LEGACY_VIEW_KEYS } from "./sidebar/core/view-state";

/*
 * The plugin's settings as stored in data.json, without Obsidian: what they
 * are, their defaults, and how a stored file is read back. Per-device view
 * state lives in sidebar/core/view-state.ts instead.
 */

export interface WysiwygSettings {
  enabled: boolean;
  /** Force Source mode so this plugin is the only renderer. */
  takeOverRendering: boolean;
  /** Note that the sidebar's "+" on Tasks appends new tasks to; "" = ask. */
  defaultTaskNote: string;
  /** List Kanban board cards on the Tasks page (they're `- [ ]` lines too). */
  boardCardsInTasks: boolean;
  /** Page Preview when the mouse rests on a note card or a task. */
  hoverPreviews: boolean;
  /** The sidebar's list panel: a gap (and rounded corners) on each side. */
  listInsetTop: boolean;
  listInsetBottom: boolean;
  listInsetLeft: boolean;
  listInsetRight: boolean;
  /** The sidebar's action row as a whole, then each of its buttons. */
  showActionRow: boolean;
  showNoteButton: boolean;
  /** Round buttons; one that's off moves into the ⋯ menu. */
  showSearchButton: boolean;
  showNewFolderButton: boolean;
  showNewTaskButton: boolean;
  showMoreButton: boolean;
  /** Commands for Edit › Writing Tools (macOS) as a whole, then which ones. */
  writingToolsCommands: boolean;
  writingTools: string[];
  /** More menu items to make commands of, one "Menu > Item" per line. */
  menuCommands: string;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
  takeOverRendering: false,
  defaultTaskNote: "",
  boardCardsInTasks: false,
  hoverPreviews: true,
  listInsetTop: false,
  listInsetBottom: true,
  listInsetLeft: false,
  listInsetRight: false,
  showActionRow: true,
  showNoteButton: true,
  showSearchButton: true,
  showNewFolderButton: true,
  showNewTaskButton: true,
  showMoreButton: true,
  writingToolsCommands: false,
  writingTools: [...WRITING_TOOLS],
  menuCommands: "",
};

const KNOWN = new Set<string>(Object.keys(DEFAULT_SETTINGS));

/** Settings that no longer exist: `sidebar` (the sidebar is always on). */
const RETIRED = ["sidebar"];

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
      const fallback = DEFAULT_SETTINGS[name];
      const valid = Array.isArray(fallback)
        ? Array.isArray(value) && value.every((item) => typeof item === "string")
        : typeof value === typeof fallback;
      if (valid) (settings as Record<string, unknown>)[name] = value;
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
