import { TaskDetails } from "./task-details";
import { PRIORITIES, Priority } from "./task-line";

/*
 * A task's Tasks-plugin fields and tags with where they sit in its text, so
 * a note can hide them behind badges and a badge can rewrite just its field.
 * Fields are read in both of Tasks' formats: emoji (📅 2026-11-25) and
 * Dataview ([due:: 2026-11-25] or (due:: 2026-11-25)).
 * `text` is what follows "- [ ] ", one line.
 */

/** How Tasks writes fields: its setting "Task format". */
export type TaskFormat = "emoji" | "dataview";

export type TaskFieldKind =
  | "id"
  | "dependsOn"
  | "priority"
  | "recurrence"
  | "onCompletion"
  | "created"
  | "start"
  | "scheduled"
  | "due"
  | "cancelled"
  | "done";

interface Piece {
  kind: TaskFieldKind | "tag" | "word";
  value: string;
  from: number;
  to: number;
}

export interface Span {
  from: number;
  to: number;
}

/** Tasks' own order, used when a field is added. */
const ORDER: TaskFieldKind[] = [
  "id", "dependsOn", "priority", "recurrence", "onCompletion", "created", "start", "scheduled", "due", "cancelled", "done",
];

const VS = "\\uFE0F?";
const MARKERS = "📅⏳⌛🛫✅➕❌🔁🔺⏫🔼🔽⏬🆔⛔🏁";
const DATE_KINDS: Record<string, TaskFieldKind> = {
  "📅": "due", "⏳": "scheduled", "⌛": "scheduled", "🛫": "start", "✅": "done", "➕": "created", "❌": "cancelled",
};
/** A Dataview-format field, [key:: value] or (key:: value); the value is m[1] or m[2]. */
const dataview = (key: string, value: string) => {
  const inner = ` *${key}:: *(${value}) *`;
  return new RegExp(`(?:\\[${inner}\\]|\\(${inner}\\))`, "uy");
};
const DATE = "\\d{4}-\\d{2}-\\d{2}";
const DATAVIEW_DATES: [string, TaskFieldKind][] = [
  ["due", "due"], ["scheduled", "scheduled"], ["start", "start"], ["created", "created"], ["completion", "done"], ["cancelled", "cancelled"],
];
const dv = (m: RegExpExecArray) => m[1] ?? m[2];
const FIELDS: [RegExp, (m: RegExpExecArray) => { kind: TaskFieldKind; value: string }][] = [
  ...DATAVIEW_DATES.map(([key, kind]): [RegExp, (m: RegExpExecArray) => { kind: TaskFieldKind; value: string }] => [
    dataview(key, DATE),
    (m) => ({ kind, value: dv(m) }),
  ]),
  [dataview("priority", "highest|high|medium|low|lowest"), (m) => ({ kind: "priority", value: dv(m) })],
  // Tasks' own pattern for a Dataview repeat rule.
  [dataview("repeat", "[a-zA-Z0-9, !]*[a-zA-Z0-9,!]"), (m) => ({ kind: "recurrence", value: dv(m) })],
  [dataview("id", "[\\w-]+"), (m) => ({ kind: "id", value: dv(m) })],
  [dataview("dependsOn", "[\\w-]+(?:\\s*,\\s*[\\w-]+)*"), (m) => ({ kind: "dependsOn", value: dv(m) })],
  [dataview("onCompletion", "keep|delete"), (m) => ({ kind: "onCompletion", value: dv(m) })],
  [new RegExp(`([📅⏳⌛🛫✅➕❌])${VS}\\s*(\\d{4}-\\d{2}-\\d{2})(?![\\w-])`, "uy"), (m) => ({ kind: DATE_KINDS[m[1]], value: m[2] })],
  [new RegExp(`([🔺⏫🔼🔽⏬])${VS}`, "uy"), (m) => ({ kind: "priority", value: PRIORITIES.find((p) => p.emoji === m[1])!.value })],
  // A repeat rule runs to the next field or tag.
  [new RegExp(`🔁${VS}\\s*([^${MARKERS}#]*[^\\s${MARKERS}#])`, "uy"), (m) => ({ kind: "recurrence", value: m[1] })],
  [new RegExp(`🆔${VS}\\s*([\\w-]+)`, "uy"), (m) => ({ kind: "id", value: m[1] })],
  [new RegExp(`⛔${VS}\\s*([\\w-]+(?:\\s*,\\s*[\\w-]+)*)`, "uy"), (m) => ({ kind: "dependsOn", value: m[1] })],
  // Tasks knows only these two; anything else after 🏁 is the user's own text.
  [new RegExp(`🏁${VS}\\s*(keep|delete)(?![\\w-])`, "uy"), (m) => ({ kind: "onCompletion", value: m[1] })],
];
/** Obsidian's tag syntax; a purely numeric one (#123) isn't a tag. */
const TAG = /#([\p{L}\p{N}_\-/]+)(?=\s|$)/uy;
const WORD = /\S+/uy;
const SPACE = /\s+/y;

function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < text.length) {
    SPACE.lastIndex = i;
    if (SPACE.exec(text)) {
      i = SPACE.lastIndex;
      continue;
    }
    let piece: Piece | null = null;
    for (const [re, read] of FIELDS) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        piece = { ...read(m), from: i, to: re.lastIndex };
        break;
      }
    }
    if (!piece) {
      TAG.lastIndex = i;
      const m = TAG.exec(text);
      if (m && !/^\d+$/.test(m[1])) piece = { kind: "tag", value: m[1], from: i, to: TAG.lastIndex };
    }
    if (!piece) {
      WORD.lastIndex = i;
      const m = WORD.exec(text)!;
      piece = { kind: "word", value: m[0], from: i, to: WORD.lastIndex };
    }
    out.push(piece);
    i = piece.to;
  }
  return out;
}

const isField = (p: Piece) => p.kind !== "word" && p.kind !== "tag";

export interface TaskFields {
  /** What a note hides: each field or badge tag with the space before it, merged. */
  hidden: Span[];
  /** What the badges show. */
  details: TaskDetails;
}

/**
 * A task's fields as a note shows them. A field or tag ending at `cursor`
 * is still being typed, so it stays text until you move on. Tags at either
 * end of the text are badges; mid-sentence ("Call #mom about it") they stay
 * words, as do the tags of a task that is only tags.
 */
export function taskFields(text: string, cursor = -1): TaskFields {
  const all = pieces(text).map((p): Piece => (p.kind !== "word" && p.to === cursor ? { ...p, kind: "word" } : p));
  const words = all.filter((p) => p.kind === "word");
  const firstField = all.findIndex(isField);
  const shown = all.filter((p, i) => {
    if (p.kind === "word") return false;
    if (p.kind !== "tag" || (firstField !== -1 && i > firstField)) return true;
    if (!words.length) return false;
    return !words.some((w) => w.to <= p.from) || !words.some((w) => w.from >= p.to);
  });

  const hidden: Span[] = [];
  for (const p of shown) {
    let from = p.from;
    let to = p.to;
    // Not back past the cursor: a space just typed after the text stays visible.
    while (from > 0 && /\s/.test(text[from - 1]) && (cursor > p.from || from - 1 >= cursor)) from--;
    // At the very start, take the space after instead, so the text starts flush.
    if (from === 0) while (to < text.length && /\s/.test(text[to])) to++;
    const last = hidden[hidden.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else hidden.push({ from, to });
  }
  // Space left after the last field would let the caret sit after the fields.
  const last = hidden[hidden.length - 1];
  if (last && !text.slice(last.to).trim()) last.to = text.length;

  const value = (kind: TaskFieldKind) => shown.find((p) => p.kind === kind)?.value ?? null;
  return {
    hidden,
    details: {
      // What stays text: the words, and tags kept in the sentence.
      description: all.filter((p) => !shown.includes(p)).map((p) => text.slice(p.from, p.to)).join(" "),
      tags: all.filter((p) => p.kind === "tag").map((p) => p.value),
      badgeTags: shown.filter((p) => p.kind === "tag").map((p) => p.value),
      priority: value("priority") as Priority | null,
      due: value("due"),
      scheduled: value("scheduled"),
      start: value("start"),
      done: value("done"),
      cancelled: value("cancelled"),
      recurrence: value("recurrence"),
    },
  };
}

/** The fields a badge can set. */
export type EditableField = "priority" | "recurrence" | "start" | "scheduled" | "due";

const DATAVIEW_KEYS: Record<EditableField, string> = { priority: "priority", recurrence: "repeat", start: "start", scheduled: "scheduled", due: "due" };

function written(kind: EditableField, value: string, format: TaskFormat): string {
  if (kind === "priority" && !PRIORITIES.some((p) => p.value === value)) return "";
  if (format === "dataview") return `[${DATAVIEW_KEYS[kind]}:: ${value}]`;
  if (kind === "priority") return PRIORITIES.find((p) => p.value === value)!.emoji;
  return `${{ recurrence: "🔁", start: "🛫", scheduled: "⏳", due: "📅" }[kind]} ${value}`;
}

const formatOf = (text: string, p: Piece): TaskFormat => (text[p.from] === "[" || text[p.from] === "(" ? "dataview" : "emoji");

/** `text` without `p` and the space before it (after it, at the start). */
function cut(text: string, p: Piece): string {
  let from = p.from;
  let to = p.to;
  while (from > 0 && /\s/.test(text[from - 1])) from--;
  if (from === 0) while (to < text.length && /\s/.test(text[to])) to++;
  return text.slice(0, from) + text.slice(to);
}

/**
 * The task's text with one field set (`value`) or removed (null), everything
 * else as it was. A new field goes where Tasks would write it. For a tag,
 * `value` names the tag to remove. A field is written in the format it's in,
 * a new one in that of the task's other fields, or `format` if it has none.
 */
export function setTaskField(text: string, kind: EditableField | "tag", value: string | null, format: TaskFormat = "emoji"): string {
  const all = pieces(text);
  if (kind === "tag") {
    const tag = all.find((p) => p.kind === "tag" && p.value === value);
    return tag ? cut(text, tag) : text;
  }
  const existing = all.filter((p) => p.kind === kind);
  // Cut from the end, so earlier positions stay right.
  const without = (ps: Piece[]) => ps.reduceRight(cut, text);
  if (value === null) return without(existing);
  const fields = all.filter(isField);
  const like = existing[0] ?? fields[0];
  const as = like ? formatOf(text, like) : format;
  const field = written(kind, value, as);
  if (!field) return text;
  if (existing.length) {
    const [first, ...rest] = existing;
    const kept = without(rest);
    return kept.slice(0, first.from) + field + kept.slice(first.to);
  }
  // Tasks puts two spaces before a Dataview field.
  const gap = as === "dataview" ? "  " : " ";
  const rank = ORDER.indexOf(kind);
  const next = fields.find((p) => ORDER.indexOf(p.kind as TaskFieldKind) > rank);
  if (next) return `${text.slice(0, next.from)}${field}${gap}${text.slice(next.from)}`;
  const at = fields.length ? fields[fields.length - 1].to : text.trimEnd().length;
  return `${text.slice(0, at)}${gap}${field}${text.slice(at)}`;
}

/** The task's text with `#tag` added after its words, before its fields; unchanged if it has it. */
export function addTaskTag(text: string, tag: string): string {
  const all = pieces(text);
  if (all.some((p) => p.kind === "tag" && p.value === tag)) return text;
  const first = all.find(isField);
  const before = text.slice(0, first ? first.from : text.length).trimEnd();
  return `${before ? `${before} ` : ""}#${tag}${text.slice(before.length)}`;
}
