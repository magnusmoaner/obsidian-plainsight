import { inFolder } from "./types";
import { compareNames, groupNotes } from "./queries";
import { matchAttachment, parseQuery } from "./search";
import type { NoteGroup, SortKey } from "./queries";

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
 * Attachments matching `search`, by file name or by the text extracted from
 * them (`extracted`: file path → that text, lower-cased), newest first.
 */
export function attachmentsFor(
  files: AttachmentFile[],
  extracted: ReadonlyMap<string, string>,
  search: string,
  sort: SortKey
): AttachmentFile[] {
  // The Filter: see core/search.ts for the query language.
  const query = parseQuery(search);
  const matches = files.filter((file) => matchAttachment(file, extracted.get(file.path) ?? "", query));
  const byName = (a: AttachmentFile, b: AttachmentFile) =>
    compareNames(a.name, b.name);
  return matches.sort((a, b) => {
    if (sort === "title") return byName(a, b);
    const key = sort === "created" ? "ctime" : "mtime";
    return b[key] - a[key] || byName(a, b);
  });
}

export type AttachmentGrouping = "date" | "folder" | "type" | "none";
export const ATTACHMENT_GROUPINGS: AttachmentGrouping[] = ["date", "folder", "type", "none"];

/** File types, in the order their groups are listed; the rest are "Other files". */
const TYPES: Array<[string, RegExp]> = [
  ["Images", /^(png|jpe?g|gif|webp|svg|bmp|avif|heic|tiff?)$/],
  ["PDFs", /^pdf$/],
  ["Audio", /^(mp3|m4a|wav|ogg|flac|aac|webm|3gp)$/],
  ["Video", /^(mp4|mov|mkv|avi|ogv)$/],
];
const OTHER = "Other files";

function typeOf(file: AttachmentFile): string {
  return TYPES.find(([, pattern]) => pattern.test(file.extension))?.[0] ?? OTHER;
}

/**
 * Group sorted attachments for the list: by month (as notes are; none under
 * a name sort), by folder (vault root first, then alphabetical), by file
 * type (images, PDFs, audio, video, other) or not at all. Order within a
 * group is kept.
 */
export function groupAttachments(
  sorted: AttachmentFile[],
  sort: SortKey,
  by: AttachmentGrouping
): NoteGroup<AttachmentFile>[] {
  if (by === "date") return groupNotes(sorted, sort);
  if (!sorted.length) return [];
  if (by === "none") return [{ label: "", notes: sorted }];
  const buckets = new Map<string, AttachmentFile[]>();
  for (const file of sorted) {
    const key = by === "folder" ? file.folder : typeOf(file);
    const list = buckets.get(key);
    if (list) list.push(file);
    else buckets.set(key, [file]);
  }
  const order = [...TYPES.map(([label]) => label), OTHER];
  const keys = [...buckets.keys()].sort(
    by === "folder"
      ? (a, b) => (a === "" ? -1 : b === "" ? 1 : compareNames(a, b))
      : (a, b) => order.indexOf(a) - order.indexOf(b)
  );
  return keys.map((key) => ({ label: by === "folder" ? key || "Vault root" : key, notes: buckets.get(key)! }));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
