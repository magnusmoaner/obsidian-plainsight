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
  /** Show the Plainsight notes sidebar. */
  sidebar: boolean;
  /** Note that the sidebar's "+" on Tasks appends new tasks to; "" = ask. */
  defaultTaskNote: string;
  /** List Kanban board cards on the Tasks page (they're `- [ ]` lines too). */
  boardCardsInTasks: boolean;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
  takeOverRendering: false,
  sidebar: true,
  defaultTaskNote: "",
  boardCardsInTasks: false,
};

const KNOWN = new Set<string>(Object.keys(DEFAULT_SETTINGS));

/**
 * A stored data.json, field by field: a value of the wrong type falls back
 * to its default. Keys this version doesn't know are returned as `extra`
 * and written back unchanged, so saving here never drops something a newer
 * version on another device stored. View state that has moved to the device
 * is left out of both.
 */
export function parseSettings(raw: unknown): { settings: WysiwygSettings; extra: Record<string, unknown> } {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const settings = { ...DEFAULT_SETTINGS };
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN.has(key)) {
      const name = key as keyof WysiwygSettings;
      if (typeof value === typeof DEFAULT_SETTINGS[name]) (settings as Record<string, unknown>)[name] = value;
    } else if (!LEGACY_VIEW_KEYS.includes(key)) {
      extra[key] = value;
    }
  }
  return { settings, extra };
}

/** What to write to data.json. */
export function serializeSettings(settings: WysiwygSettings, extra: Record<string, unknown>): Record<string, unknown> {
  return { ...extra, ...settings };
}
