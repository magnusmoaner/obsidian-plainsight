const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FENCE = /^\s*(```|~~~)/;

// A Dataview key: optional ** / __ wrapping around word characters, spaces,
// hyphens or emoji.
const DV_KEY = String.raw`(?:\*\*|__)?[\p{L}\p{N}\p{Extended_Pictographic}_][\p{L}\p{N}\p{Extended_Pictographic}_ -]*?(?:\*\*|__)?`;
// A field value may contain links, whose brackets must not end the field.
const DV_VALUE = String.raw`((?:\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|[^\[\]()])*?)`;
const DV_LINE_FIELD = new RegExp(String.raw`^${DV_KEY}::\s+`, "u");
const DV_INLINE_SQUARE = new RegExp(String.raw`\[${DV_KEY}::\s+${DV_VALUE}\]`, "gu");
const DV_INLINE_ROUND = new RegExp(String.raw`\(${DV_KEY}::\s+${DV_VALUE}\)`, "gu");

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
    // Dataview fields keep their value. Dataview requires a space after
    // "::", which is what tells a field from code like std::vector or
    // [fe80::1]; keys may be wrapped in ** or __ and may hold emoji.
    .replace(DV_LINE_FIELD, "")
    .replace(DV_INLINE_SQUARE, "$1")
    .replace(DV_INLINE_ROUND, "$1")
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
