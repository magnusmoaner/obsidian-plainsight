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

export function summarize(facts: FileFacts, text: string): NoteSummary {
  const tags = normalizeTags(facts.tags);
  const pinned = facts.frontmatter?.pinned;
  const extracted = facts.frontmatter?.type === "extracted-text";
  return {
    path: facts.path,
    title: facts.basename,
    folder: facts.folder,
    tags,
    pinned: pinned === true || pinned === "true",
    mtime: facts.mtime,
    ctime: facts.ctime,
    snippet: extractSnippet(text),
    tasks: parseTasks(text),
    thumbnail: firstImage(text),
    searchText: `${facts.basename} ${tags.join(" ")} ${text.slice(0, SEARCH_CAP)}`.toLowerCase(),
    extracted,
    sourceLinks: extracted ? fileLinks(text) : [],
  };
}
