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
}

/** Everything the sidebar needs to know about one note. */
export interface NoteSummary {
  path: string;
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
  /** For a companion: the link target of the file it was extracted from. */
  sourceLink: string | null;
}

/** Done or cancelled — no longer an open task. */
export function isClosed(task: TaskItem): boolean {
  return task.status === "x" || task.status === "X" || task.status === "-";
}

/** True if `folder` is `root` or lies beneath it. "" is the vault root. */
export function inFolder(folder: string, root: string): boolean {
  return root === "" || folder === root || folder.startsWith(`${root}/`);
}
