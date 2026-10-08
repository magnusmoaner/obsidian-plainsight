/** A Markdown task line, as found in a note. */
export interface TaskItem {
  /** 0-based line number in the note. */
  line: number;
  /** The character between the brackets: " ", "x", "/", "-", … */
  status: string;
  /** Everything after `[ ] `, including any Tasks-plugin fields. */
  text: string;
  /** YYYY-MM-DD from the Tasks plugin's 📅 field, if present. */
  due: string | null;
  /** Text of the nearest heading above the task (a Kanban board's list). */
  section: string | null;
  /** YYYY-MM-DD from the Tasks plugin's ✅ (completed) field, if present. */
  done: string | null;
}

/**
 * What a sidebar item is. Boards (Kanban plugin) are Markdown notes with a
 * `kanban-plugin` property; canvases are JSON. Only plain notes take the
 * sidebar's text edits (pin, tags, task toggles): writing a frontmatter
 * line or a task line into a canvas's JSON would corrupt it.
 */
export type NoteKind = "note" | "board" | "canvas";

/** Everything the sidebar needs to know about one note. */
export interface NoteSummary {
  path: string;
  kind: NoteKind;
  /** Boards: column (lane) names. Empty for other kinds. */
  columns: string[];
  /** Boards: number of cards; canvases: number of nodes. 0 otherwise. */
  items: number;
  title: string;
  /** Parent folder path; "" for the vault root. */
  folder: string;
  /** Tags without the leading "#", de-duplicated. */
  tags: string[];
  pinned: boolean;
  mtime: number;
  ctime: number;
  snippet: string;
  tasks: TaskItem[];
  /** Link target of the first embedded image, unresolved. */
  thumbnail: string | null;
  /** Lower-cased title, tags and body for search, capped in length. */
  searchText: string;
  /**
   * A machine-extracted text companion of an attachment (`type:
   * extracted-text`), not a note the user wrote. Shown with its file under
   * Attachments rather than as a note.
   */
  extracted: boolean;
  /**
   * For a companion: its plain [[links]] that look like files, in order. The
   * Obsidian layer takes the first that resolves to an attachment as the
   * source. Several candidates, because a dotted note name ("Notes 2026.10")
   * looks like a file link until it's resolved.
   */
  sourceLinks: string[];
}

/** Done or cancelled — no longer an open task. */
export function isClosed(task: TaskItem): boolean {
  return task.status === "x" || task.status === "X" || task.status === "-";
}

/** True if `folder` is `root` or lies beneath it. "" is the vault root. */
export function inFolder(folder: string, root: string): boolean {
  return root === "" || folder === root || folder.startsWith(`${root}/`);
}

/**
 * `path` after `from` was renamed to `to`: unchanged unless it is `from` or
 * lies beneath it (a renamed folder carries its descendants along).
 */
export function renamedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}
