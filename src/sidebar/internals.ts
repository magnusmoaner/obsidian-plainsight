import { App, normalizePath } from "obsidian";

/**
 * Undocumented Obsidian and plugin APIs, isolated so they're easy to audit.
 * Every accessor degrades to null/defaults when the shape isn't what we
 * expect, so a changed internal hides a feature instead of throwing.
 */

export interface Shortcut {
  kind: "file" | "folder" | "search";
  title: string;
  target: string;
}

type Loose = Record<string, unknown> | null | undefined;

function internalPlugin(app: App, id: string): Loose {
  const plugins = (app as unknown as { internalPlugins?: { getPluginById?(id: string): unknown } })
    .internalPlugins;
  const plugin = plugins?.getPluginById?.(id) as { enabled?: boolean; instance?: Loose } | null;
  return plugin?.enabled ? plugin.instance : null;
}

const lastSegment = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

/** Bookmarks (flattened out of groups), or null if the plugin is off. */
export function readShortcuts(app: App): Shortcut[] | null {
  const items = internalPlugin(app, "bookmarks")?.items;
  if (!Array.isArray(items)) return null;
  const out: Shortcut[] = [];
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      const item = raw as Record<string, unknown>;
      const title = typeof item.title === "string" && item.title ? item.title : null;
      if (item.type === "group" && Array.isArray(item.items)) walk(item.items);
      else if (item.type === "file" && typeof item.path === "string")
        out.push({ kind: "file", target: item.path, title: title ?? lastSegment(item.path) });
      else if (item.type === "folder" && typeof item.path === "string")
        out.push({ kind: "folder", target: item.path, title: title ?? lastSegment(item.path) });
      else if (item.type === "search" && typeof item.query === "string")
        out.push({ kind: "search", target: item.query, title: title ?? item.query });
    }
  };
  walk(items);
  return out;
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

export function openGlobalSearch(app: App, query: string): boolean {
  const search = internalPlugin(app, "global-search") as { openGlobalSearch?(q: string): void } | null;
  if (typeof search?.openGlobalSearch !== "function") return false;
  search.openGlobalSearch(query);
  return true;
}

export function openSettingsTab(app: App, tabId: string): void {
  const setting = (app as unknown as { setting?: { open(): void; openTabById(id: string): void } })
    .setting;
  setting?.open();
  setting?.openTabById(tabId);
}

/**
 * Toggle through the Tasks plugin so done dates and recurrence follow its
 * rules. Returns the replacement text (several lines for a recurring task),
 * or null when the API is unavailable.
 */
export function tasksToggle(app: App, line: string, path: string): string | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: unknown }> } })
    .plugins?.plugins;
  const api = plugins?.["obsidian-tasks-plugin"]?.apiV1 as
    | { executeToggleTaskDoneCommand?(line: string, path: string): string }
    | undefined;
  if (typeof api?.executeToggleTaskDoneCommand !== "function") return null;
  return api.executeToggleTaskDoneCommand(line, path);
}
