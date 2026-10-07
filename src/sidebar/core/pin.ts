// The body group is optional so an empty block (`---\n---`) is still frontmatter.
const FRONTMATTER = /^---(\r?\n)(?:([\s\S]*?)\r?\n)?---(?=\r?\n|$)/;
const PINNED_LINE = /^pinned:[^\n\r]*(\r?\n)?/m;

/**
 * Set or clear `pinned: true` by editing that one line of the frontmatter as
 * text. Obsidian's processFrontMatter re-serializes the whole YAML block —
 * dropping comments and changing quoting — which would break the promise
 * that pinning touches nothing else.
 */
export function setPinned(text: string, pinned: boolean): string {
  const fm = FRONTMATTER.exec(text);
  if (!fm) {
    if (!pinned) return text;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    return `---${eol}pinned: true${eol}---${eol}${text}`;
  }
  const [block, eol, body = ""] = fm;
  const rest = text.slice(block.length);
  const hasLine = PINNED_LINE.test(body);
  if (pinned) {
    const next = hasLine
      ? body.replace(/^pinned:[^\n\r]*/m, "pinned: true")
      : `${body}${body ? eol : ""}pinned: true`;
    return `---${eol}${next}${eol}---${rest}`;
  }
  if (!hasLine) return text;
  // Remove the line together with its line break (or the preceding one if it was last).
  const next = body.replace(PINNED_LINE, "").replace(/\r?\n$/, "");
  return `---${eol}${next}${next ? eol : ""}---${rest}`;
}
