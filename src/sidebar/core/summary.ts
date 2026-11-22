import { listColours } from "../../boards/board";
import { extractSnippet } from "./snippet";
import { ocrBoxes } from "./ocr-boxes";
import { isPlainlist, parsePlainlist } from "./plainlist";
import { parseTasks } from "./tasks";
import { CanvasMap, NoteSummary } from "./types";

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

// Embeds (![[…]]) match too and are skipped: no lookbehind, which older iOS lacks.
const FILE_LINK = /(!?)\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

/**
 * Plain (non-embed) wikilinks whose target has a file extension, e.g.
 * [[scan.pdf]], in order. Only a syntactic guess — "[[Notes 2026.10]]" also
 * qualifies — so callers must resolve and check what each one points at.
 */
export function fileLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(FILE_LINK)) {
    if (match[1]) continue;
    const target = match[2].trim();
    if (/\.[a-z0-9]{2,5}$/i.test(target) && !/\.md$/i.test(target)) out.push(target);
  }
  return out;
}

// A board embed block (Plainsight's or Kanban Embed's): its `board:` line
// names the board, as a [[link]] or a path.
const BOARD_EMBED = /^```(?:plainsight-board|kanban-embed)[^\n]*\n(?:(?!```)[^\n]*\n)*?boards?\s*:\s*(?:\[\[([^\]|#]+)|([^\s\[][^\n]*))/m;

/** Link target of the first board embedded in the note, unresolved. */
export function embeddedBoard(text: string): string | null {
  const match = BOARD_EMBED.exec(text);
  return match ? (match[1] ?? match[2]).trim() : null;
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
export function parseBoard(text: string): { columns: string[]; laneCards: number[]; cards: number; end: number } {
  const columns: string[] = [];
  const laneCards: number[] = [];
  let cards = 0;
  let inFence = false;
  const lines = text.split(/\r?\n/);
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The plugin puts archived cards under a `***` rule ("## Archive"), then
    // its settings block. Neither is part of the visible board.
    if (/^%%\s*kanban:settings/.test(line) || (!inFence && /^\*{3,}\s*$/.test(line))) {
      end = i;
      break;
    }
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      columns.push(heading[1]);
      laneCards.push(0);
    } else if (columns.length && /^[-*+]\s+/.test(line)) {
      cards++;
      laneCards[laneCards.length - 1]++;
    }
  }
  return { columns, laneCards, cards, end };
}

/** Which of the board plugins' boards are read as boards; Plainsight's own always are. */
export interface BoardKinds {
  kanban: boolean;
  taskList: boolean;
}

/**
 * `boards` null: boards are off, and a board file is summarized as the
 * ordinary note it also is. So is a plugin's board whose kind is off.
 */
export function summarize(facts: FileFacts, text: string, boards: BoardKinds | null = { kanban: true, taskList: true }): NoteSummary {
  const tags = normalizeTags(facts.tags);
  const pinned = facts.frontmatter?.pinned;
  const extracted = facts.frontmatter?.type === "extracted-text";
  const isBoard =
    !!boards &&
    (facts.frontmatter?.["plainsight-plugin"] !== undefined || (boards.kanban && facts.frontmatter?.["kanban-plugin"] !== undefined));
  const board = isBoard ? parseBoard(text) : null;
  // Task List Kanban's own test: any truthy kanban_plugin value (its
  // settings, a JSON string, or an empty mapping for a new board).
  const taskListBoard = !!boards?.taskList && !board && Boolean(facts.frontmatter?.kanban_plugin);
  // List colours are a Plainsight board's; on a Kanban plugin board they're not shown.
  const ownBoard = !!board && facts.frontmatter?.["plainsight-plugin"] !== undefined;
  const colours = ownBoard ? listColours(text) : {};
  const plainlist = !board && isPlainlist(facts.frontmatter) ? parsePlainlist(text) : undefined;
  const projectLines = new Set(plainlist?.projects.map((p) => p.line));
  return {
    path: facts.path,
    kind: board || taskListBoard ? "board" : "note",
    columns: board?.columns ?? [],
    laneCards: board?.laneCards ?? [],
    laneColours: board?.columns.map((name) => colours[name] ?? null) ?? [],
    items: board?.cards ?? 0,
    title: facts.basename,
    folder: facts.folder,
    tags,
    pinned: pinned === true || pinned === "true",
    mtime: facts.mtime,
    ctime: facts.ctime,
    // A board's raw text is lane headings and card lines; its columns read better.
    snippet: board ? board.columns.join(" · ") : extractSnippet(text),
    // A board's archived cards are done and hidden in the plugin; keep them
    // off the Tasks page too.
    tasks: board ? parseTasks(text).filter((t) => t.line < board.end) : parseTasks(text).filter((t) => !projectLines.has(t.line)),
    thumbnail: firstImage(text),
    embeddedBoard: boards && !board ? embeddedBoard(text) : null,
    searchText: `${facts.basename} ${tags.join(" ")} ${text.slice(0, SEARCH_CAP)}`.toLowerCase(),
    extracted,
    sourceLinks: extracted ? fileLinks(text) : [],
    ocrBoxes: board ? [] : ocrBoxes(text),
    taskListBoard,
    ownBoard,
    ...(plainlist && { plainlist }),
  };
}

/**
 * A canvas (JSON) as a sidebar item: its text boxes are its content. Tasks
 * stay empty on purpose — toggling one would rewrite a line of the JSON.
 */
export function summarizeCanvas(facts: FileFacts, json: string): NoteSummary {
  let texts: string[] = [];
  let names: string[] = [];
  let nodes = 0;
  let map: CanvasMap | undefined;
  try {
    const data = JSON.parse(json) as { nodes?: CanvasNode[]; edges?: Array<{ fromNode?: unknown; toNode?: unknown }> };
    const list = Array.isArray(data.nodes) ? data.nodes : [];
    nodes = list.length;
    texts = list
      .filter((n) => n.type === "text" && typeof n.text === "string")
      .map((n) => n.text as string);
    // What the other boxes hold, top to bottom: files, links and groups by name.
    names = [...list]
      .sort((a, b) => num(a.y) - num(b.y) || num(a.x) - num(b.x))
      .map(nodeName)
      .filter((n): n is string => !!n);
    map = canvasMap(list, Array.isArray(data.edges) ? data.edges : []);
  } catch {
    // Unreadable or mid-write canvas: still list it, just without content.
  }
  const body = texts.join("\n\n");
  return {
    path: facts.path,
    kind: "canvas",
    columns: [],
    laneCards: [],
    laneColours: [],
    items: nodes,
    title: facts.basename,
    folder: facts.folder,
    tags: [],
    pinned: false,
    mtime: facts.mtime,
    ctime: facts.ctime,
    snippet: [extractSnippet(body), ...names].filter(Boolean).join(" · "),
    tasks: [],
    thumbnail: firstImage(body),
    embeddedBoard: null,
    searchText: `${facts.basename} ${body.slice(0, SEARCH_CAP)}`.toLowerCase(),
    extracted: false,
    sourceLinks: [],
    ocrBoxes: [],
    taskListBoard: false,
    ownBoard: false,
    ...(map && { canvasMap: map }),
  };
}

interface CanvasNode {
  id?: unknown;
  type?: string;
  text?: unknown;
  file?: unknown;
  url?: unknown;
  label?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  color?: unknown;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A file, link or group box's name; null for a text box (its text is the snippet). */
function nodeName(n: CanvasNode): string | null {
  if (n.type === "file" && typeof n.file === "string") return n.file.split("/").pop()!.replace(/\.md$/i, "");
  if (n.type === "link" && typeof n.url === "string") return n.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  if (n.type === "group" && typeof n.label === "string" && n.label.trim()) return n.label.trim();
  return null;
}

/** Up to this many boxes are drawn: enough to see a canvas's shape. */
const MAP_NODES = 80;

function canvasMap(list: CanvasNode[], edges: Array<{ fromNode?: unknown; toNode?: unknown }>): CanvasMap | undefined {
  const boxes = list.filter((n) => num(n.width) > 0 && num(n.height) > 0).slice(0, MAP_NODES);
  if (!boxes.length) return undefined;
  const index = new Map(boxes.map((n, i) => [n.id, i]));
  return {
    nodes: boxes.map((n) => ({
      x: num(n.x),
      y: num(n.y),
      w: num(n.width),
      h: num(n.height),
      color: typeof n.color === "string" && /^([1-6]|#[0-9a-f]{3,8})$/i.test(n.color) ? n.color : null,
      group: n.type === "group",
      label: (n.type === "text" && typeof n.text === "string" ? extractSnippet(n.text) : nodeName(n))?.slice(0, 60) || null,
    })),
    edges: edges
      .map((e): [number, number] | null => {
        const from = index.get(e.fromNode);
        const to = index.get(e.toNode);
        return from !== undefined && to !== undefined ? [from, to] : null;
      })
      .filter((e): e is [number, number] => e !== null),
  };
}
