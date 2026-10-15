import { PRIORITIES, Priority } from "./task-line";

/**
 * A task line's details in the Tasks plugin's emoji format, read for
 * display and grouping only (nothing here writes). Fields follow the
 * description, as the Tasks plugin writes them; an emoji may carry a
 * variation selector (U+FE0F).
 */
export interface TaskDetails {
  /** What the task says: without Tasks fields, or the tags shown as badges. */
  description: string;
  /** Every tag in the task, without "#", in order. */
  tags: string[];
  /** Tags taken off the start or end of the description, to show as badges. A
   * tag mid-sentence stays in the text: "Call #mom about it". */
  badgeTags: string[];
  priority: Priority | null;
  due: string | null;
  scheduled: string | null;
  start: string | null;
  done: string | null;
  cancelled: string | null;
  /** As written, e.g. "every week when done". */
  recurrence: string | null;
}

const FIELD = /[📅⏳⌛🛫✅➕❌🔁🔺⏫🔼🔽⏬🆔⛔🏁]/u;
const date = (markers: string) => new RegExp(`[${markers}]\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})`, "u");
const DUE = date("📅");
const SCHEDULED = date("⏳⌛");
const START = date("🛫");
const DONE = date("✅");
const CANCELLED = date("❌");
const RECURRENCE = /🔁️?\s*([^📅⏳⌛🛫✅➕❌🔺⏫🔼🔽⏬🆔⛔🏁#]+)/u;
/** Obsidian's tag syntax, minus purely numeric ones (#123 isn't a tag). */
const TAG = /^#([\p{L}\p{N}_\-/]+)$/u;

function tagOf(token: string): string | null {
  const m = TAG.exec(token);
  return m && !/^\d+$/.test(m[1]) ? m[1] : null;
}

/** Tags in running text, at word starts only (so not a URL's #anchor). */
function tagsIn(text: string): string[] {
  return text
    .split(/\s+/)
    .map(tagOf)
    .filter((t): t is string => t !== null);
}

export function taskDetails(text: string): TaskDetails {
  const at = text.search(FIELD);
  const head = (at === -1 ? text : text.slice(0, at)).trim();
  const fields = at === -1 ? "" : text.slice(at);

  // Tags at either end of the description are labels; inside it, words.
  const words = head.split(/\s+/).filter(Boolean);
  const leading: string[] = [];
  const trailing: string[] = [];
  while (words.length && tagOf(words[0])) leading.push(tagOf(words.shift()!)!);
  while (words.length && tagOf(words[words.length - 1])) trailing.unshift(tagOf(words.pop()!)!);
  const fieldTags = tagsIn(fields);
  const onlyTags = words.length === 0;
  const badgeTags = onlyTags ? fieldTags : [...leading, ...trailing, ...fieldTags];

  const priority = PRIORITIES.find((p) => fields.includes(p.emoji))?.value ?? null;
  const match = (re: RegExp) => re.exec(fields)?.[1] ?? null;
  return {
    description: onlyTags ? head : words.join(" "),
    tags: [...leading, ...tagsIn(words.join(" ")), ...trailing, ...fieldTags],
    badgeTags,
    priority,
    due: match(DUE),
    scheduled: match(SCHEDULED),
    start: match(START),
    done: match(DONE),
    cancelled: match(CANCELLED),
    recurrence: RECURRENCE.exec(fields)?.[1].trim() || null,
  };
}

/** "every week when done" → "Every week": how often, for labels. */
export function recurrenceLabel(rule: string): string {
  const base = rule.replace(/\s+when done\s*$/i, "").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Roughly how many days between repeats, to order recurrence groups. */
export function recurrenceDays(rule: string): number {
  const m = /every\s+(?:(\d+)\s+)?(day|weekday|week|month|quarter|year)s?\b/i.exec(rule);
  if (m) {
    const unit = { day: 1, weekday: 1.4, week: 7, month: 30, quarter: 91, year: 365 }[m[2].toLowerCase()] ?? 0;
    return unit * Number(m[1] ?? 1);
  }
  if (/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(rule)) return 7;
  return Number.POSITIVE_INFINITY;
}
