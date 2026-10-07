import { inFolder, NoteSummary } from "./types";
import type { SortKey } from "./queries";

/** A non-note file, as the Attachments place shows it. */
export interface AttachmentFile {
  path: string;
  name: string;
  /** Parent folder path; "" for the vault root. */
  folder: string;
  extension: string;
  size: number;
  mtime: number;
  ctime: number;
}

/**
 * Turn Obsidian's `attachmentFolderPath` setting into a test for "is this
 * folder where attachments live?":
 * - "/" or ""        → vault root: attachments sit among notes, no folder to hide
 * - "./"             → next to each note: likewise nothing to hide
 * - "./Attachments"  → a subfolder of that name beside any note, wherever it is
 * - "Files/Media"    → one fixed folder
 */
export function attachmentFolderMatcher(setting: string): (folder: string) => boolean {
  const value = setting.trim().replace(/\/+$/, "");
  if (value === "" || value === "/" || value === ".") return () => false;
  if (value.startsWith("./")) {
    const relative = value.slice(2);
    // Matched as a whole run of path segments, so "./Attachments" doesn't
    // catch a notebook called "Old Attachments".
    return (folder) => `/${folder}/`.includes(`/${relative}/`);
  }
  const fixed = value.replace(/^\/+/, "");
  return (folder) => inFolder(folder, fixed) && folder !== "";
}

/**
 * Attachments matching `search`, by file name or by any text extracted from
 * them (`companions`: file path → its extracted-text notes), newest first.
 */
export function attachmentsFor(
  files: AttachmentFile[],
  companions: ReadonlyMap<string, NoteSummary[]>,
  search: string,
  sort: SortKey
): AttachmentFile[] {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = files.filter((file) => {
    if (!terms.length) return true;
    const extracted = (companions.get(file.path) ?? []).map((n) => n.searchText).join(" ");
    const text = `${file.name.toLowerCase()} ${extracted}`;
    return terms.every((term) => text.includes(term));
  });
  const byName = (a: AttachmentFile, b: AttachmentFile) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return matches.sort((a, b) => {
    if (sort === "title") return byName(a, b);
    const key = sort === "created" ? "ctime" : "mtime";
    return b[key] - a[key] || byName(a, b);
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
