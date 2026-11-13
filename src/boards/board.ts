/**
 * A Kanban-plugin board file, read and edited line by line. Every edit
 * touches only the lines of the cards or lists involved, so whatever this
 * parser doesn't model (the archive, the settings block, stray text) stays
 * exactly as it was.
 */

export interface Card {
  /** First line, and one past the last line, of the card. */
  line: number;
  end: number;
  /** The checkbox character; null for a plain "- text" card. */
  check: string | null;
  /** The card's Markdown, continuation lines un-indented. */
  text: string;
}

export interface Lane {
  /** The heading line, and one past the lane's last line. */
  line: number;
  end: number;
  title: string;
  /** The WIP limit kept in the heading as " (N)", or "". */
  limit: string;
  /** The "**Complete**" line, if the list marks its cards done. */
  marker: number | null;
  /** The status cards take when they land in this list: "x", "/", "-" or null. */
  status: string | null;
  /** Minimized: only its name and count show. */
  collapsed: boolean;
  /** One of LIST_COLOURS, or null for none. */
  colour: string | null;
  cards: Card[];
}

export interface Board {
  lanes: Lane[];
  /** Where the archive or settings block starts (or the file ends). */
  end: number;
}

/** Points at a card as it was when the board was drawn. */
export interface CardRef {
  lane: number;
  card: number;
  /** Its first line then; an edit refuses to run if the line has changed. */
  raw: string;
}

/** Points at a list as it was when the board was drawn. */
export interface LaneRef {
  lane: number;
  /** Its heading line then. */
  raw: string;
}

/** The file changed since the board was drawn; the edit would hit the wrong line. */
export class StaleBoardError extends Error {}

const CARD = /^[-*+]\s+(?:\[(.)\](?:\s+|$))?(.*)$/;
const HEADING = /^##\s+(.*?)\s*$/;
const WIP = /^(.*?)\s*\((\d+)\)$/;
const INDENT = "    ";
const SETTINGS = /^%%\s*kanban:settings/;
/**
 * Where lists that mark their cards in progress or cancelled are kept: by
 * list name, in the Kanban settings block. Kanban keeps keys it doesn't
 * know there, while it drops any marker line but its own "**Complete**".
 */
const STATUS_KEY = "plainsight-list-status";

/** The settings block's JSON line and what it holds; null if there's no (readable) block. */
function readSettings(lines: string[]): { line: number; data: Record<string, unknown> } | null {
  const at = lines.findIndex((l) => SETTINGS.test(l));
  if (at < 0 || !/^```/.test(lines[at + 1] ?? "")) return null;
  try {
    const data = JSON.parse(lines[at + 2]) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? { line: at + 2, data: data as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

/** The colours a list can have: Obsidian's own named colours, which follow the theme. */
export const LIST_COLOURS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
/** A list's colour, kept by list name like its status. */
const COLOUR_KEY = "plainsight-list-colour";

/** What the settings block holds under `key` for each list, by name; only values `valid` accepts. */
function readNamed(lines: string[], key: string, valid: (value: string) => boolean): Record<string, string> {
  const stored = readSettings(lines)?.data[key];
  const out: Record<string, string> = {};
  if (stored && typeof stored === "object") {
    for (const [title, value] of Object.entries(stored)) if (typeof value === "string" && valid(value)) out[title] = value;
  }
  return out;
}

const readStatuses = (lines: string[]) => readNamed(lines, STATUS_KEY, (v) => v === "/" || v === "-");
/** Each coloured list's colour, by list name, for a board's text. */
export const listColours = (text: string) => readColours(text.split(/\r?\n/));
const readColours = (lines: string[]) => readNamed(lines, COLOUR_KEY, (v) => (LIST_COLOURS as readonly string[]).includes(v));

/**
 * Change what the settings block holds. A board without one gets it, if the
 * change leaves something to store; an unreadable block is left alone:
 * better no status than a broken board.
 */
function writeSettings(lines: string[], change: (data: Record<string, unknown>) => void): void {
  const settings = readSettings(lines);
  if (settings) {
    change(settings.data);
    lines[settings.line] = JSON.stringify(settings.data);
    return;
  }
  if (lines.some((l) => SETTINGS.test(l))) return;
  const data: Record<string, unknown> = { "kanban-plugin": "board" };
  change(data);
  if (Object.keys(data).length === 1) return;
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push("", "", "%% kanban:settings", "```", JSON.stringify(data), "```", "%%");
}

/** Store `values` under `key`, dropping lists that no longer exist. */
function writeNamed(lines: string[], key: string, values: Record<string, string>): void {
  const titles = new Set(parseBoard(lines.join("\n")).lanes.map((l) => l.title));
  const kept = Object.fromEntries(Object.entries(values).filter(([title]) => titles.has(title)));
  writeSettings(lines, (data) => {
    if (Object.keys(kept).length) data[key] = kept;
    else delete data[key];
  });
}

const writeStatuses = (lines: string[], statuses: Record<string, string>) => writeNamed(lines, STATUS_KEY, statuses);

/** Which lists are minimized, by position: the Kanban plugin's own setting, so both agree. */
const COLLAPSE_KEY = "list-collapse";

function writeCollapsed(lines: string[], collapsed: boolean[]): void {
  writeSettings(lines, (data) => {
    if (collapsed.some(Boolean) || COLLAPSE_KEY in data) data[COLLAPSE_KEY] = collapsed;
  });
}

export function parseBoard(text: string): Board {
  const lines = text.split(/\r?\n/);
  const lanes: Lane[] = [];
  let end = lines.length;
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) start = close + 1;
  }
  let card: Card | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const lane = lanes[lanes.length - 1];
    // A card's continuation lines are indented (blank ones keep their indent).
    if (card && /^[ \t]/.test(line)) {
      card.text += "\n" + line.replace(/^( {1,4}|\t)/, "");
      card.end = i + 1;
      continue;
    }
    card = null;
    // The archive sits under a `***` rule, then the plugin's settings block.
    if (SETTINGS.test(line) || /^\*{3,}\s*$/.test(line)) {
      end = i;
      break;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      if (lane) lane.end = i;
      const wip = WIP.exec(heading[1]);
      lanes.push({
        line: i,
        end: lines.length,
        title: wip ? wip[1] : heading[1],
        limit: wip ? wip[2] : "",
        marker: null,
        status: null,
        collapsed: false,
        colour: null,
        cards: [],
      });
      continue;
    }
    if (!lane) continue;
    const match = CARD.exec(line);
    if (match) {
      card = { line: i, end: i + 1, check: match[1] ?? null, text: match[2] };
      lane.cards.push(card);
    } else if (!lane.cards.length && lane.marker === null && /^\*\*[^*]+\*\*\s*$/.test(line)) {
      lane.marker = i;
    }
  }
  const last = lanes[lanes.length - 1];
  if (last) last.end = end;
  const statuses = readStatuses(lines);
  const colours = readColours(lines);
  const collapsed = readSettings(lines)?.data[COLLAPSE_KEY];
  lanes.forEach((lane, i) => {
    lane.status = lane.marker !== null ? "x" : statuses[lane.title] ?? null;
    lane.colour = colours[lane.title] ?? null;
    lane.collapsed = Array.isArray(collapsed) && collapsed[i] === true;
  });
  return { lanes, end };
}

/** A card's text without its date, time and block id, which are shown as chips. */
export function cardDisplay(text: string): { body: string; date: string | null; time: string | null } {
  let date: string | null = null;
  let time: string | null = null;
  const body = text
    .replace(/@@\{([^}]+)\}/, (_, t: string) => ((time = t), ""))
    .replace(/@\{([^}]+)\}|@\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/, (_, a?: string, b?: string) => ((date = (a ?? b)!), ""))
    .replace(/\s\^[\w-]+\s*$/m, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return { body, date, time };
}

/** Kanban's done mark; any other character (" ", "/", "-", …) is not done. */
export function isDone(check: string | null): boolean {
  return check === "x" || check === "X";
}

/**
 * Completes or reopens a task line as the Tasks plugin would: with its done
 * date, and for a repeating task its next round as a second line. Null when
 * that plugin isn't there.
 */
export type TasksToggle = (line: string) => string | null;

const DONE_LINE = /^\s*[-*+]\s+\[[xX]\]/;

/**
 * The card's lines after `via` has toggled its first line, if that left it
 * done (or not) as `wantDone` asks; null otherwise, and without `via`.
 */
function toggledLines(lines: string[], c: Card, via: TasksToggle | undefined, wantDone: boolean): string[] | null {
  const out = via?.(lines[c.line])?.split("\n");
  if (!out || out.some((l) => DONE_LINE.test(l)) !== wantDone) return null;
  return [...out, ...lines.slice(c.line + 1, c.end)];
}

/** Tick or untick a card: through `via` when given, else just its checkbox. */
export function toggleCard(text: string, ref: CardRef, via?: TasksToggle): string {
  return edit(text, (lines, board) => {
    const c = findCard(lines, board, ref);
    const toggled = toggledLines(lines, c, via, !isDone(c.check));
    if (toggled) return void lines.splice(c.line, c.end - c.line, ...toggled);
    const next = c.check === null || c.check === " " ? "x" : " ";
    lines[c.line] = lines[c.line].replace(/^([-*+]\s+)(\[.\]\s*)?/, `$1[${next}] `);
  });
}

/** Set a card's status: " " open, "/" in progress, "x" done (through `via` when given), "-" cancelled. */
export function setCardStatus(text: string, ref: CardRef, status: string, via?: TasksToggle): string {
  return edit(text, (lines, board) => {
    const c = findCard(lines, board, ref);
    const toggled = status === "x" && !isDone(c.check) ? toggledLines(lines, c, via, true) : null;
    if (toggled) return void lines.splice(c.line, c.end - c.line, ...toggled);
    lines[c.line] = lines[c.line].replace(/^([-*+]\s+)(\[.\]\s*)?/, `$1[${status}] `);
  });
}

export function editCard(text: string, ref: CardRef, body: string): string {
  return edit(text, (lines, board) => {
    const c = findCard(lines, board, ref);
    lines.splice(c.line, c.end - c.line, ...cardLines(c.check ?? " ", body));
  });
}

export function deleteCard(text: string, ref: CardRef): string {
  return edit(text, (lines, board) => {
    const c = findCard(lines, board, ref);
    lines.splice(c.line, c.end - c.line);
  });
}

export function addCard(text: string, ref: LaneRef, body: string): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    lines.splice(cardSlot(lines, lane, lane.cards.length), 0, ...cardLines(lane.status ?? " ", body));
  });
}

/**
 * Put a new card at position `index` (0 = top) of a list: one that comes
 * from elsewhere, with the status it had. A list that gives its cards a
 * status gives it to this one; a done list completes it through `via`.
 */
export function insertCard(text: string, to: LaneRef, index: number, body: string, check: string, via?: TasksToggle): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, to);
    let card = cardLines(lane.status && lane.status !== "x" ? lane.status : check, body);
    if (lane.status === "x" && !isDone(check)) {
      const done = via?.(card[0])?.split("\n");
      card = done?.some((l) => DONE_LINE.test(l)) ? [...done, ...card.slice(1)] : cardLines("x", body);
    }
    lines.splice(cardSlot(lines, lane, index), 0, ...card);
  });
}

/**
 * Move a card to position `index` (0 = top) of list `to`, counted before
 * the move. A card that a list completes or reopens goes through `via`.
 */
export function moveCard(text: string, ref: CardRef, to: LaneRef, index: number, via?: TasksToggle): string {
  return edit(text, (lines, board) => {
    const c = findCard(lines, board, ref);
    const from = board.lanes[ref.lane];
    const target = findLane(lines, board, to);
    let at = cardSlot(lines, target, index);
    if (at >= c.line && at <= c.end) return; // dropped where it already is
    let check = c.check ?? " ";
    // As in Kanban: a list with a status gives it to what lands in it, and a
    // card leaving such a list for a plain one is open again.
    if (target !== from && target.status) check = isDone(check) && target.status === "x" ? check : target.status;
    else if (target !== from && from.status && check.toLowerCase() === from.status) check = " ";
    const moved =
      (isDone(check) !== isDone(c.check ?? " ") ? toggledLines(lines, c, via, isDone(check)) : null) ?? cardLines(check, c.text);
    lines.splice(c.line, c.end - c.line);
    if (at > c.line) at -= c.end - c.line;
    lines.splice(at, 0, ...moved);
  });
}

export function addLane(text: string, title: string): string {
  return edit(text, (lines, board) => {
    const block = [`## ${title}`, "", "", ""];
    if (board.end > 0 && lines[board.end - 1]?.trim()) block.unshift("");
    lines.splice(board.end, 0, ...block);
  });
}

export function renameLane(text: string, ref: LaneRef, title: string): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    // What's kept by the list's name goes with it to the new one.
    const statuses = readStatuses(lines);
    const colours = readColours(lines);
    if (statuses[lane.title]) statuses[title] = statuses[lane.title];
    if (colours[lane.title]) colours[title] = colours[lane.title];
    lines[lane.line] = `## ${title}${lane.limit ? ` (${lane.limit})` : ""}`;
    writeStatuses(lines, statuses);
    writeNamed(lines, COLOUR_KEY, colours);
  });
}

export function deleteLane(text: string, ref: LaneRef): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    const statuses = readStatuses(lines);
    const colours = readColours(lines);
    lines.splice(lane.line, lane.end - lane.line);
    writeStatuses(lines, statuses);
    writeNamed(lines, COLOUR_KEY, colours);
    writeCollapsed(lines, board.lanes.filter((l) => l !== lane).map((l) => l.collapsed));
  });
}

/** Minimize a list, or open it again. */
export function setLaneCollapsed(text: string, ref: LaneRef, collapsed: boolean): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    writeCollapsed(lines, board.lanes.map((l) => (l === lane ? collapsed : l.collapsed)));
  });
}

/** Give a list one of LIST_COLOURS, or null to take its colour away. */
export function setLaneColour(text: string, ref: LaneRef, colour: string | null): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    const colours = readColours(lines);
    if (colour && (LIST_COLOURS as readonly string[]).includes(colour)) colours[lane.title] = colour;
    else delete colours[lane.title];
    writeNamed(lines, COLOUR_KEY, colours);
  });
}

/**
 * The status cards take when they land in the list: "x" done (Kanban's own
 * "**Complete**" line), "/" in progress, "-" cancelled, or null for none.
 * Cards already in the list keep the status they have.
 */
export function setLaneStatus(text: string, ref: LaneRef, status: string | null): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    const statuses = readStatuses(lines);
    if (status === "/" || status === "-") statuses[lane.title] = status;
    else delete statuses[lane.title];
    if (lane.marker !== null && status !== "x") lines.splice(lane.marker, 1);
    if (lane.marker === null && status === "x") {
      let at = lane.line + 1;
      if (at < lane.end && !lines[at].trim()) at++;
      else lines.splice(at++, 0, "");
      lines.splice(at, 0, "**Complete**");
    }
    writeStatuses(lines, statuses);
  });
}

/** Move a list so it sits before list `index` (lanes.length = last), counted before the move. */
export function moveLane(text: string, ref: LaneRef, index: number): string {
  return edit(text, (lines, board) => {
    const lane = findLane(lines, board, ref);
    if (index === ref.lane || index === ref.lane + 1) return;
    const block = lines.slice(lane.line, lane.end);
    if (block[block.length - 1]?.trim()) block.push("");
    let at = index < board.lanes.length ? board.lanes[index].line : board.end;
    lines.splice(lane.line, lane.end - lane.line);
    if (at > lane.line) at -= lane.end - lane.line;
    lines.splice(at, 0, ...block);
    // Minimized lists are kept by position: carry this one's along.
    const order = board.lanes.filter((l) => l !== lane);
    order.splice(index > ref.lane ? index - 1 : index, 0, lane);
    writeCollapsed(lines, order.map((l) => l.collapsed));
  });
}

/** The board a ```plainsight-board (or ```kanban-embed) block names: `board: [[link]]` or a path. */
export function embedTarget(source: string): string | null {
  const match = /^boards?\s*:\s*(?:\[\[([^\]|#]+)|([^\s\[].*))/m.exec(source);
  return match ? (match[1] ?? match[2]).trim() : null;
}

/** The embed block for a board, as inserted into a note. */
export function embedBlock(link: string): string {
  return "```plainsight-board\nboard: [[" + link + "]]\n```\n";
}

/** A note's text with the board's embed block after everything in it. */
export function appendEmbed(text: string, link: string): string {
  const body = text.replace(/\s*$/, "");
  return body ? `${body}\n\n${embedBlock(link)}` : embedBlock(link);
}

const EMBED = /^```(?:plainsight-board|kanban-embed)[^\n]*\n[\s\S]*?^```/gm;

/**
 * A board was renamed: point the embed blocks that named it (as `oldPath`,
 * by full path or by name alone) at `newLink`. Obsidian updates links in
 * prose and properties itself, but not inside code blocks.
 */
export function retargetEmbeds(text: string, oldPath: string, newLink: string): string {
  const full = oldPath.replace(/\.md$/i, "");
  const name = full.split("/").pop()!;
  return text.replace(EMBED, (block) =>
    block.replace(/^(boards?\s*:\s*)(?:\[\[([^\]|#]+)([^\]]*)\]\]|([^\s\[].*))$/m, (line, key: string, link?: string, rest?: string, bare?: string) => {
      const target = (link ?? bare ?? "").trim().replace(/\.md$/i, "");
      if (target !== full && target !== name) return line;
      return link !== undefined ? `${key}[[${newLink}${rest ?? ""}]]` : `${key}${newLink}.md`;
    })
  );
}

/**
 * What makes a note a board: Plainsight's own mark, or the Kanban plugin's.
 * Both hold the same lists and cards; only the Kanban plugin opens the latter.
 */
export function isBoardFrontmatter(frontmatter: Record<string, unknown> | undefined): boolean {
  return frontmatter?.["plainsight-plugin"] !== undefined || frontmatter?.["kanban-plugin"] !== undefined;
}

/**
 * A new Plainsight board: Inbox, Doing and Done. Inbox is left the plain
 * grey of a list without a colour; Doing is blue and Done green. "Done"
 * marks its cards complete.
 */
export const NEW_BOARD = [
  "---",
  "plainsight-plugin: board",
  "---",
  "",
  "## Inbox",
  "",
  "",
  "",
  "## Doing",
  "",
  "",
  "",
  "## Done",
  "",
  "**Complete**",
  "",
  "",
  "%% kanban:settings",
  "```",
  JSON.stringify({ "kanban-plugin": "board", [COLOUR_KEY]: { Doing: "blue", Done: "green" } }),
  "```",
  "%%",
].join("\n");

function edit(text: string, fn: (lines: string[], board: Board) => void): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  fn(lines, parseBoard(text));
  return lines.join(eol);
}

function findCard(lines: string[], board: Board, ref: CardRef): Card {
  const card = board.lanes[ref.lane]?.cards[ref.card];
  if (!card || lines[card.line] !== ref.raw) throw new StaleBoardError();
  return card;
}

function findLane(lines: string[], board: Board, ref: LaneRef): Lane {
  const lane = board.lanes[ref.lane];
  if (!lane || lines[lane.line] !== ref.raw) throw new StaleBoardError();
  return lane;
}

/** The line a card inserted at position `index` of `lane` goes on. */
function cardSlot(lines: string[], lane: Lane, index: number): number {
  if (index < lane.cards.length) return lane.cards[index].line;
  if (lane.cards.length) return lane.cards[lane.cards.length - 1].end;
  let at = (lane.marker ?? lane.line) + 1;
  // Kanban leaves one blank line under the heading.
  if (lane.marker === null && at < lane.end && !lines[at].trim()) at++;
  return at;
}

function cardLines(check: string, body: string): string[] {
  const [first, ...rest] = body.trim().split(/\r?\n/);
  return [`- [${check}] ${first}`, ...rest.map((l) => INDENT + l)];
}
