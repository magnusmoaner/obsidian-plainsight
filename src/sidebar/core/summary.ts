import { extractSnippet } from "./snippet";
import { parseTasks } from "./tasks";
import { NoteSummary } from "./types";

/** What the Obsidian layer knows about a file without reading it. */
export interface FileFacts {
  path: string;
  basename: string;
  folder: string;
  mtime: number;
  ctime: number;
  /** As returned by getAllTags: with "#", possibly repeated. */
  tags: string[];
  frontmatter: Record<string, unknown> | undefined;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const EMBED = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const SEARCH_CAP = 20000;

const FILE_LINK = /(?<!!)\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

/**
 * Plain (non-embed) wikilinks whose target has a file extension, e.g.
 * [[scan.pdf]], in order. Only a syntactic guess — "[[Notes 2026.10]]" also
 * qualifies — so callers must resolve and check what each one points at.
 */
export function fileLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(FILE_LINK)) {
    const target = match[1].trim();
    if (/\.[a-z0-9]{2,5}$/i.test(target) && !/\.md$/i.test(target)) out.push(target);
  }
  return out;
}

export function firstImage(text: string): string | null {
  for (const match of text.matchAll(EMBED)) {
    const target = (match[1] ?? safeDecode(match[2])).trim();
    if (IMAGE.test(target)) return target;
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Strip "#" and de-duplicate case-insensitively (Obsidian tags are), keeping
 * the first spelling seen. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.replace(/^#/, "");
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()];
}

const FENCE = /^\s*(```|~~~)/;

/**
 * Columns and cards of a Kanban-plugin board: "## " headings are columns,
 * list items under them are cards. Stops at the plugin's trailing
 * "%% kanban:settings" block.
 */
export function parseBoard(text: string): { columns: string[]; cards: number } {
  const columns: string[] = [];
  let cards = 0;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^%%\s*kanban:settings/.test(line)) break;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) columns.push(heading[1]);
    else if (columns.length && /^[-*+]\s+/.test(line)) cards++;
  }
  return { columns, cards };
}

export function summarize(facts: FileFacts, text: string): NoteSummary {
  const tags = normalizeTags(facts.tags);
  const pinned = facts.frontmatter?.pinned;
  const extracted = facts.frontmatter?.type === "extracted-text";
  const board = facts.frontmatter?.["kanban-plugin"] !== undefined ? parseBoard(text) : null;
  return {
    path: facts.path,
    kind: board ? "board" : "note",
    columns: board?.columns ?? [],
    items: board?.cards ?? 0,
    title: facts.basename,
    folder: facts.folder,
    tags,
    pinned: pinned === true || pinned === "true",
    mtime: facts.mtime,
    ctime: facts.ctime,
    // A board's raw text is lane headings and card lines; its columns read better.
    snippet: board ? board.columns.join(" · ") : extractSnippet(text),
    tasks: parseTasks(text),
    thumbnail: firstImage(text),
    searchText: `${facts.basename} ${tags.join(" ")} ${text.slice(0, SEARCH_CAP)}`.toLowerCase(),
    extracted,
    sourceLinks: extracted ? fileLinks(text) : [],
  };
}

/**
 * A canvas (JSON) as a sidebar item: its text boxes are its content. Tasks
 * stay empty on purpose — toggling one would rewrite a line of the JSON.
 */
export function summarizeCanvas(facts: FileFacts, json: string): NoteSummary {
  let texts: string[] = [];
  let nodes = 0;
  try {
    const data = JSON.parse(json) as { nodes?: Array<{ type?: string; text?: unknown }> };
    const list = Array.isArray(data.nodes) ? data.nodes : [];
    nodes = list.length;
    texts = list
      .filter((n) => n.type === "text" && typeof n.text === "string")
      .map((n) => n.text as string);
  } catch {
    // Unreadable or mid-write canvas: still list it, just without content.
  }
  const body = texts.join("\n\n");
  return {
    path: facts.path,
    kind: "canvas",
    columns: [],
    items: nodes,
    title: facts.basename,
    folder: facts.folder,
    tags: [],
    pinned: false,
    mtime: facts.mtime,
    ctime: facts.ctime,
    snippet: extractSnippet(body),
    tasks: [],
    thumbnail: firstImage(body),
    searchText: `${facts.basename} ${body.slice(0, SEARCH_CAP)}`.toLowerCase(),
    extracted: false,
    sourceLinks: [],
  };
}
