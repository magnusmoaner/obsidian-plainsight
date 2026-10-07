import { App, moment, Notice, normalizePath, PaneType, TFile, WorkspaceLeaf } from "obsidian";
import { applyTemplate } from "./core/format";
import { addTag, appendLine } from "./core/edits";
import { setPinned } from "./core/pin";
import { matchTaskLine, toggleTaskLine } from "./core/tasks";
import { TaskItem } from "./core/types";
import { templateOptions, tasksToggle } from "./internals";

// Obsidian types its moment export as the namespace, which isn't callable
// under this tsconfig; the runtime value is the moment() function.
const now = moment as unknown as () => { format(pattern: string): string };

/*
 * Every write the sidebar makes. Each changes exactly what it names — one
 * task line, one frontmatter line, or a new file — and nothing else, so
 * Tasks-plugin metadata (📅 🔁 ⏫ 🆔 …) passes through untouched.
 */

/**
 * Toggle the task on `lineNo`, but only if that line is still exactly the
 * task we rendered (same status, same text). If the note changed underneath
 * us, write nothing rather than tick — or let the Tasks plugin rewrite — the
 * wrong line. Returns whether the file was changed, so the caller can reset
 * its checkbox when it wasn't.
 */
export async function toggleTask(app: App, path: string, task: TaskItem): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  let written = false;
  let stale = false;
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const line = lines[task.line];
    const current = line === undefined ? null : matchTaskLine(line);
    if (!current || current.status !== task.status || current.text !== task.text) {
      stale = true;
      return data;
    }
    const cr = line.endsWith("\r") ? "\r" : "";
    const viaTasks = tasksToggle(app, line.replace(/\r$/, ""), path);
    const next =
      viaTasks !== null
        ? viaTasks
            .split("\n")
            .map((l) => l + cr)
            .join("\n")
        : toggleTaskLine(line);
    if (next === null || next === line) return data;
    lines[task.line] = next;
    written = true;
    return lines.join("\n");
  });
  if (stale) new Notice("That task moved or changed in its note, so nothing was ticked.");
  return written;
}

/** Flip `pinned: true` by editing that one frontmatter line (see setPinned). */
export async function togglePin(app: App, file: TFile): Promise<void> {
  const pinned = app.metadataCache.getFileCache(file)?.frontmatter?.pinned;
  const isPinned = pinned === true || pinned === "true";
  await app.vault.process(file, (data) => setPinned(data, !isPinned));
}

/** Append a finished task line (e.g. from the Tasks dialog) to `file`. */
export async function addTaskLine(app: App, file: TFile, line: string): Promise<void> {
  await app.vault.process(file, (data) => appendLine(data, line.trim()));
}

/** Add a tag to the note's tags property, editing only that property. */
export async function addTagToNote(app: App, file: TFile, tag: string): Promise<void> {
  await app.vault.process(file, (data) => addTag(data, tag));
}

function availablePath(app: App, folder: string, base: string): string {
  for (let n = 0; ; n++) {
    const name = n ? `${base} ${n}` : base;
    const path = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}

/** Create a note in `folder` (null = Obsidian's default location) and open it. */
export async function createNote(app: App, folder: string | null, template?: TFile): Promise<void> {
  const parent = folder ?? app.fileManager.getNewFileParent("").path;
  const path = availablePath(app, parent === "/" ? "" : parent, "Untitled");
  const title = path.split("/").pop()!.replace(/\.md$/, "");
  let text = "";
  if (template) {
    const opts = templateOptions(app);
    text = applyTemplate(
      await app.vault.cachedRead(template),
      title,
      (pattern) => now().format(pattern),
      opts.dateFormat,
      opts.timeFormat
    );
  }
  const file = await app.vault.create(path, text);
  await openFile(app, file, false);
}

/** `mode` is Keymap.isModEvent(evt) for clicks: false = current tab, true/"tab" = new tab. */
export async function openFile(
  app: App,
  file: TFile,
  mode: PaneType | boolean,
  line?: number
): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.getLeaf(mode);
  await leaf.openFile(file, line === undefined ? undefined : { eState: { line } });
  return leaf;
}
