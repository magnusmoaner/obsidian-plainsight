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
