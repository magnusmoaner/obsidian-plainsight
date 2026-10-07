/*
 * Text-level edits for the sidebar's "+" actions. Like setPinned, they touch
 * only the line(s) they're about — never re-serialize the whole frontmatter
 * (Obsidian's processFrontMatter would drop comments and change quoting).
 */

const FRONTMATTER = /^---(\r?\n)(?:([\s\S]*?)\r?\n)?---(?=\r?\n|$)/;

/** A clean tag from user input, or null if Obsidian wouldn't accept it. */
export function normalizeTag(input: string): string | null {
  const tag = input.trim().replace(/^#+/, "").replace(/^\/+|\/+$/g, "");
  if (!tag) return null;
  // Obsidian tags: letters (any script), digits, _ - / — and not all digits.
  if (!/^[\p{L}\p{N}_\-/]+$/u.test(tag)) return null;
  if (/^[\d/]+$/.test(tag)) return null;
  return tag;
}

const clean = (value: string) => value.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").toLowerCase();

/** Add `tag` to the note's `tags` property, keeping whatever style it uses. */
export function addTag(text: string, tag: string): string {
  const fm = FRONTMATTER.exec(text);
  if (!fm) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    return `---${eol}tags:${eol}  - ${tag}${eol}---${eol}${text}`;
  }
  const [block, eol, body = ""] = fm;
  const rest = text.slice(block.length);
  const lines = body ? body.split(/\r?\n/) : [];
  const wanted = tag.toLowerCase();
  const at = lines.findIndex((l) => /^tags:/.test(l));

  if (at === -1) {
    lines.push("tags:", `  - ${tag}`);
  } else {
    const value = lines[at].slice("tags:".length).trim();
    if (value === "") {
      // Block list (possibly empty) on the following indented "- " lines.
      let end = at + 1;
      while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;
      const items = lines.slice(at + 1, end);
      if (items.some((l) => clean(l.replace(/^\s+-\s/, "")) === wanted)) return text;
      const indent = items.length ? items[items.length - 1].match(/^\s+/)![0] : "  ";
      lines.splice(end, 0, `${indent}- ${tag}`);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
      if (items.some((v) => clean(v) === wanted)) return text;
      lines[at] = `tags: [${[...items, tag].join(", ")}]`;
    } else {
      const items = value.split(",").map((v) => v.trim()).filter(Boolean);
      if (items.some((v) => clean(v) === wanted)) return text;
      lines[at] = `tags: [${[...items, tag].join(", ")}]`;
    }
  }
  return `---${eol}${lines.join(eol)}${eol}---${rest}`;
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
