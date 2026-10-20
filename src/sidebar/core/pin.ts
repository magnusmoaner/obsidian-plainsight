import { prependFrontmatter, readFrontmatter, writeFrontmatter } from "./frontmatter";

// Top-level key only: an indented "pinned:" belongs to a nested value.
const PINNED = /^pinned:/;

/**
 * Set or clear `pinned: true` by editing that one line of the frontmatter as
 * text. Obsidian's processFrontMatter re-serializes the whole YAML block —
 * dropping comments and changing quoting — which would break the promise
 * that pinning touches nothing else.
 */
export function setPinned(text: string, pinned: boolean): string {
  const fm = readFrontmatter(text);
  if (!fm) return pinned ? prependFrontmatter(text, ["pinned: true"]) : text;
  const at = fm.lines.findIndex((l) => PINNED.test(l));
  if (pinned) {
    if (at === -1) fm.lines.push("pinned: true");
    else fm.lines[at] = "pinned: true";
  } else {
    if (at === -1) return text;
    fm.lines.splice(at, 1);
  }
  return writeFrontmatter(fm);
}
