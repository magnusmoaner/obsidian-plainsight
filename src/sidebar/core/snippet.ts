const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The note's first useful text, for a card. Lines are cleaned of Markdown
 * and joined until `max` characters, then truncated with an ellipsis.
 */
export function extractSnippet(text: string, max = 160): string {
  const body = text.replace(FRONTMATTER, "");
  const parts: string[] = [];
  let length = 0;
  let inFence = false;
  for (const raw of body.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = cleanLine(raw);
    if (!line) continue;
    parts.push(line);
    length += line.length + 1;
    if (length >= max) break;
  }
  const joined = parts.join(" ");
  if (joined.length <= max) return joined;
  return `${joined.slice(0, max - 1).trimEnd()}…`;
}

function cleanLine(raw: string): string {
  const line = raw.trim();
  if (!line) return "";
  if (/^#{1,6}\s/.test(line)) return ""; // the card title already says it
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return ""; // horizontal rule
  if (/^\|.*\|$/.test(line)) return ""; // table row
  return line
    .replace(/^(>\s*)+/, "") // quote / callout prefix
    .replace(/^\[![^\]]+\][+-]?\s*/, "") // callout token, keep its title
    .replace(/^([-*+]|\d+[.)])\s+(\[.\]\s+)?/, "") // list and task markers
    .replace(/!\[\[[^\]]*\]\]/g, "") // embeds
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // aliased wikilink → alias
    .replace(/\[\[([^\]|#]*)(?:#[^\]]*)?\]\]/g, "$1") // wikilink → target
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown link → text
    .replace(/(\*\*|__|==|~~|`)/g, "") // paired inline marks
    .replace(/(^|\s)[*_](?=\S)/g, "$1") // opening single * or _
    .replace(/(\S)[*_](?=[\s.,;:!?)]|$)/g, "$1") // closing single * or _
    .replace(/<[^>]+>/g, "") // inline HTML
    .replace(/\s+/g, " ")
    .trim();
}
