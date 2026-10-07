import { App, moment, Notice, normalizePath, PaneType, TFile, WorkspaceLeaf } from "obsidian";
import { applyTemplate } from "./core/format";
import { toggleTaskLine } from "./core/tasks";
import { templateOptions, tasksToggle } from "./internals";

// Obsidian types its moment export as the namespace, which isn't callable
// under this tsconfig; the runtime value is the moment() function.
const now = moment as unknown as () => { format(pattern: string): string };

/*
 * Every write the sidebar makes. Each changes exactly what it names — one
 * task line, one frontmatter key, or a new file — and nothing else, so
 * Tasks-plugin metadata (📅 🔁 ⏫ 🆔 …) passes through untouched.
 */

/**
 * Toggle the task on `lineNo`, but only if that line still holds the task we
 * rendered (`expectedText`). If the note changed underneath us, do nothing
 * rather than tick the wrong line.
 */
export async function toggleTask(
  app: App,
  path: string,
  lineNo: number,
  expectedText: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  let stale = false;
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const line = lines[lineNo];
    const bare = line?.replace(/\r$/, "");
    if (bare === undefined || !bare.trimEnd().endsWith(expectedText)) {
      stale = true;
      return data;
    }
    const cr = line.endsWith("\r") ? "\r" : "";
    const viaTasks = tasksToggle(app, bare, path);
    const next =
      viaTasks !== null
        ? viaTasks
            .split("\n")
            .map((l) => l + cr)
            .join("\n")
        : toggleTaskLine(line);
    if (next === null || next === line) return data;
    lines[lineNo] = next;
    return lines.join("\n");
  });
  if (stale) new Notice("That note changed. The task list has been refreshed.");
}

export async function togglePin(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (fm.pinned === true || fm.pinned === "true") delete fm.pinned;
    else fm.pinned = true;
  });
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
