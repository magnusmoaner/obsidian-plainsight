/*
 * Text-level edits for the sidebar's "+" actions. Like setPinned, they touch
 * only the line(s) they're about — never re-serialize the whole frontmatter
 * (Obsidian's processFrontMatter would drop comments and change quoting).
 */

import { prependFrontmatter, readFrontmatter, writeFrontmatter } from "./frontmatter";

/** A clean tag from user input, or null if Obsidian wouldn't accept it. */
export function normalizeTag(input: string): string | null {
  const tag = input.trim().replace(/^#+/, "").replace(/^\/+|\/+$/g, "");
  if (!tag) return null;
  // Obsidian tags: letters/marks of any script, digits, emoji, _ - / — and
  // not only digits. No spaces or punctuation.
  if (!/^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\u200d\ufe0f_\-/]+$/u.test(tag)) return null;
  if (/^[\d/]+$/.test(tag)) return null;
  return tag;
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");
const same = (value: string, tag: string) =>
  unquote(value).replace(/^#/, "").toLowerCase() === tag.toLowerCase();

/** A list item we can compare safely: plain, or fully quoted — no comment. */
const SAFE_ITEM = /^(?:"[^"]*"|'[^']*'|[^#"'[\]{},][^#"'[\]{}]*?)\s*$/;
const ITEM = /^(\s*)-\s+(.*)$/;
const BLANK_OR_COMMENT = /^\s*(#.*)?$/;

/**
 * Add `tag` to the note's tags property by editing only its lines, in the
 * style the note already uses. Recognised shapes: no tags key, a block list
 * (any consistent indent, incl. column 0), a one-line `[a, b]` list without
 * quotes or comments, and a single plain word. Returns the text unchanged
 * when the tag is already there, and **null for anything else** —
 * comments, multi-line flow lists, quoted commas, mixed indents — rather
 * than risk writing YAML that no longer parses (which would make Obsidian
 * drop every property of the note).
 */
export function addTag(text: string, tag: string): string | null {
  const fm = readFrontmatter(text);
  if (!fm) return prependFrontmatter(text, ["tags:", `  - ${tag}`]);
  const { lines } = fm;
  // Obsidian reads the first key matching /^tags?$/i.
  const at = lines.findIndex((l) => /^tags?\s*:/i.test(l));
  if (at === -1) {
    lines.push("tags:", `  - ${tag}`);
    return writeFrontmatter(fm);
  }
  const colon = lines[at].indexOf(":");
  const key = lines[at].slice(0, colon).trimEnd();
  const value = lines[at].slice(colon + 1).trim();

  if (value === "") {
    let end = at + 1;
    let indent: string | null = null;
    const items: string[] = [];
    for (; end < lines.length; end++) {
      const m = ITEM.exec(lines[end]);
      if (!m) break;
      if (indent !== null && m[1] !== indent) return null; // mixed indents
      if (!SAFE_ITEM.test(m[2])) return null;
      indent = m[1];
      items.push(m[2]);
    }
    // Comments or blank lines followed by more items: the list continues
    // in a shape we don't edit.
    for (let i = end; i < lines.length && BLANK_OR_COMMENT.test(lines[i]); i++) {
      if (ITEM.test(lines[i + 1] ?? "")) return null;
    }
    // An indented non-item line right after the key (nested map, block
    // scalar) isn't a list at all.
    if (!items.length && end < lines.length && /^\s+\S/.test(lines[end])) return null;
    if (items.some((item) => same(item, tag))) return text;
    lines.splice(end, 0, `${indent ?? "  "}- ${tag}`);
    return writeFrontmatter(fm);
  }

  const flow = /^\[([^\]#"'[{}]*)\]$/.exec(value);
  if (flow) {
    const items = flow[1].split(",").map((v) => v.trim()).filter(Boolean);
    if (items.some((item) => same(item, tag))) return text;
    lines[at] = `${key}: [${[...items, tag].join(", ")}]`;
    return writeFrontmatter(fm);
  }

  // A single plain word. Anything with spaces, commas, quotes or comments
  // has ambiguous meaning to Obsidian; leave it for the user.
  if (/^[^\s#"'[\]{},:]+$/.test(value)) {
    if (same(value, tag)) return text;
    lines[at] = `${key}: [${value}, ${tag}]`;
    return writeFrontmatter(fm);
  }
  return null;
}

/**
 * Add `item` to the list property `key`, editing only its lines: a new
 * property if the note has none, a new last item if it's a plain block list.
 * Returns the text unchanged if the item is there already, and null if the
 * property is in any other shape (a flow list, a single value, comments).
 */
export function addListItem(text: string, key: string, item: string): string | null {
  const fm = readFrontmatter(text);
  if (!fm) return prependFrontmatter(text, [`${key}:`, `  - ${item}`]);
  const { lines } = fm;
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at === -1) {
    lines.push(`${key}:`, `  - ${item}`);
    return writeFrontmatter(fm);
  }
  if (lines[at].slice(key.length + 1).trim() !== "") return null;
  let end = at + 1;
  let indent: string | null = null;
  for (; end < lines.length; end++) {
    const m = ITEM.exec(lines[end]);
    if (!m) break;
    if ((indent !== null && m[1] !== indent) || !SAFE_ITEM.test(m[2])) return null;
    if (unquote(m[2]) === unquote(item)) return text;
    indent = m[1];
  }
  // Anything indented after the items (or instead of them) isn't a plain list.
  if (end < lines.length && /^\s+\S/.test(lines[end])) return null;
  lines.splice(end, 0, `${indent ?? "  "}- ${item}`);
  return writeFrontmatter(fm);
}

/**
 * Set the one-line text property `key` to `value` ("" removes it), editing
 * only that line. Null if the property is there in a shape that isn't one
 * line (a block of text, a list), which is left for the user.
 */
export function setTextProperty(text: string, key: string, value: string): string | null {
  const line = `${key}: ${JSON.stringify(value.replace(/\s+/g, " ").trim())}`;
  const fm = readFrontmatter(text);
  if (!fm) return value ? prependFrontmatter(text, [line]) : text;
  const { lines } = fm;
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at === -1) {
    if (!value) return text;
    lines.push(line);
    return writeFrontmatter(fm);
  }
  const current = lines[at].slice(key.length + 1).trim();
  const continues = /^\s+\S/.test(lines[at + 1] ?? "");
  if (current === "" ? continues : /^[|>]/.test(current) || continues) return null;
  if (value) lines[at] = line;
  else lines.splice(at, 1);
  return writeFrontmatter(fm);
}

/** Append `line` as the file's last line, keeping its line-ending style. */
export function appendLine(text: string, line: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (!text) return `${line}${eol}`;
  const sep = text.endsWith("\n") ? "" : eol;
  return `${text}${sep}${line}${eol}`;
}

/** Why a folder name won't work, or null if it's fine. */
export function folderNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (/[\\/:*?"<>|#^[\]]/.test(trimmed)) return "Names can't contain \\ / : * ? \" < > | # ^ [ ]";
  if (trimmed.startsWith(".")) return "Names can't start with a dot.";
  return null;
}

/**
 * Where `path` (a file or folder) ends up when it's moved into `folder`
 * ("" is the vault root). Null when there's nothing to do or it can't be
 * done: it's there already, or it's a folder being moved into itself.
 */
export function movedPath(path: string, folder: string): string | null {
  const cut = path.lastIndexOf("/");
  const parent = cut === -1 ? "" : path.slice(0, cut);
  if (parent === folder) return null;
  if (folder === path || folder.startsWith(`${path}/`)) return null;
  const name = path.slice(cut + 1);
  return folder ? `${folder}/${name}` : name;
}
