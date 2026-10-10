import { App, normalizePath } from "obsidian";

/**
 * Undocumented Obsidian and plugin APIs, isolated so they're easy to audit.
 * Every accessor degrades to null/defaults when the shape isn't what we
 * expect, so a changed internal hides a feature instead of throwing.
 */

export interface Bookmark {
  kind: "file" | "folder" | "search";
  title: string;
  /** Vault path for file/folder bookmarks, the query for search ones. */
  target: string;
  /** "#Heading" or "#^block" for bookmarks that point inside a note. */
  subpath: string;
  /** The plugin's own item object; removeBookmark needs this exact reference. */
  raw: unknown;
  /** The bookmark group(s) it sits in, e.g. "Work › Clients"; null at top level. */
  group: string | null;
}

type Loose = Record<string, unknown> | null | undefined;

function internalPlugin(app: App, id: string): Loose {
  const plugins = (app as unknown as { internalPlugins?: { getPluginById?(id: string): unknown } })
    .internalPlugins;
  const plugin = plugins?.getPluginById?.(id) as { enabled?: boolean; instance?: Loose } | null;
  return plugin?.enabled ? plugin.instance : null;
}

const lastSegment = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

/** Bookmarks (flattened out of groups), or null if the core plugin is off. */
export function readBookmarks(app: App): Bookmark[] | null {
  const items = internalPlugin(app, "bookmarks")?.items;
  if (!Array.isArray(items)) return null;
  const out: Bookmark[] = [];
  const walk = (list: unknown[], groups: string[]) => {
    const group = groups.length ? groups.join(" › ") : null;
    for (const raw of list) {
      const item = raw as Record<string, unknown>;
      const title = typeof item.title === "string" && item.title ? item.title : null;
      const subpath = typeof item.subpath === "string" ? item.subpath : "";
      if (item.type === "group" && Array.isArray(item.items)) walk(item.items, [...groups, title ?? "Group"]);
      else if (item.type === "file" && typeof item.path === "string")
        out.push({ kind: "file", target: item.path, subpath, title: title ?? lastSegment(item.path), raw, group });
      else if (item.type === "folder" && typeof item.path === "string")
        out.push({ kind: "folder", target: item.path, subpath: "", title: title ?? lastSegment(item.path), raw, group });
      else if (item.type === "search" && typeof item.query === "string")
        out.push({ kind: "search", target: item.query, subpath: "", title: title ?? item.query, raw, group });
    }
  };
  walk(items, []);
  return out;
}

/**
 * Remove a bookmark through the Bookmarks plugin, which finds its group,
 * saves, and fires "changed". This is the only way to delete a bookmark to a
 * deleted note: the core Bookmarks pane hides those. Returns false if the
 * API isn't there.
 */
export function removeBookmark(app: App, bookmark: Bookmark): boolean {
  const instance = internalPlugin(app, "bookmarks") as { removeItem?(item: unknown): void } | null;
  if (typeof instance?.removeItem !== "function") return false;
  instance.removeItem(bookmark.raw);
  return true;
}

/** The current Bookmarks plugin instance (identity changes on toggle), or null. */
export function bookmarksInstance(app: App): unknown {
  return internalPlugin(app, "bookmarks") ?? null;
}

/**
 * Call `callback` whenever bookmarks are added, removed, renamed or moved.
 * The Bookmarks instance is an Events object that triggers "changed" from
 * its _onItemsChanged. Returns an unsubscribe function, or null if the
 * plugin is off or the shape is unexpected.
 */
export function onBookmarksChanged(app: App, callback: () => void): (() => void) | null {
  const instance = internalPlugin(app, "bookmarks") as {
    on?(name: string, cb: () => void): unknown;
    offref?(ref: unknown): void;
  } | null;
  if (typeof instance?.on !== "function" || typeof instance.offref !== "function") return null;
  const ref = instance.on("changed", callback);
  return () => instance.offref?.(ref);
}

export interface TemplateOptions {
  folder: string | null;
  dateFormat: string;
  timeFormat: string;
}

export function templateOptions(app: App): TemplateOptions {
  const options = internalPlugin(app, "templates")?.options as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const folder = str(options?.folder);
  return {
    folder: folder ? normalizePath(folder) : null,
    dateFormat: str(options?.dateFormat) ?? "YYYY-MM-DD",
    timeFormat: str(options?.timeFormat) ?? "HH:mm",
  };
}

/**
 * Obsidian's "Default location for new attachments" (Files & links), as
 * stored: "/", "./", "./Sub" or "Folder". Read through the same
 * undocumented-but-stable vault.getConfig as the Live Preview takeover.
 */
export function attachmentFolderSetting(app: App): string {
  const vault = app.vault as unknown as { getConfig?(key: string): unknown };
  const value = vault.getConfig?.("attachmentFolderPath");
  return typeof value === "string" ? value : "/";
}

export function openGlobalSearch(app: App, query: string): boolean {
  const search = internalPlugin(app, "global-search") as { openGlobalSearch?(q: string): void } | null;
  if (typeof search?.openGlobalSearch !== "function") return false;
  search.openGlobalSearch(query);
  return true;
}

type Commands = {
  commands?: Record<string, unknown>;
  executeCommandById?(id: string): boolean;
};

/** Whether a command (core or plugin) is registered right now. */
export function hasCommand(app: App, id: string): boolean {
  const commands = (app as unknown as { commands?: Commands }).commands;
  return !!commands?.commands?.[id] && typeof commands.executeCommandById === "function";
}

/**
 * Run a command by id, as the command palette would. Returns false if it
 * isn't registered or declined to run (e.g. needs an open note).
 */
export function runCommand(app: App, id: string): boolean {
  const commands = (app as unknown as { commands?: Commands }).commands;
  if (!hasCommand(app, id)) return false;
  return commands!.executeCommandById!(id) !== false;
}

export function openSettingsTab(app: App, tabId: string): void {
  const setting = (app as unknown as { setting?: { open(): void; openTabById(id: string): void } })
    .setting;
  setting?.open();
  setting?.openTabById(tabId);
}

function tasksApi(app: App): Record<string, unknown> | undefined {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: unknown }> } })
    .plugins?.plugins;
  return plugins?.["obsidian-tasks-plugin"]?.apiV1 as Record<string, unknown> | undefined;
}

/**
 * Open the Tasks plugin's own "Create task" dialog (due, scheduled, priority,
 * recurrence…). Resolves to the finished task line, or "" if cancelled.
 * Returns null when the Tasks API isn't available.
 */
export function tasksCreateModal(app: App): Promise<string> | null {
  const api = tasksApi(app) as { createTaskLineModal?(): Promise<string> } | undefined;
  return typeof api?.createTaskLineModal === "function" ? api.createTaskLineModal() : null;
}

/**
 * Toggle through the Tasks plugin so done dates and recurrence follow its
 * rules. Returns the replacement text (several lines for a recurring task),
 * or null when the API is unavailable.
 */
export function tasksToggle(app: App, line: string, path: string): string | null {
  const api = tasksApi(app) as
    | { executeToggleTaskDoneCommand?(line: string, path: string): string }
    | undefined;
  if (typeof api?.executeToggleTaskDoneCommand !== "function") return null;
  return api.executeToggleTaskDoneCommand(line, path);
}
