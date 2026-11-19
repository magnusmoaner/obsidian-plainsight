import { App, Menu, setIcon } from "obsidian";
import { dueDateLabel } from "./core/format";
import { TaskDetails } from "./core/task-details";
import { EditableField, addTaskTag, setTaskField } from "./core/task-fields";
import { TagModal } from "./modals";
import { PRIORITIES, RECURRENCES, duePresets } from "./core/task-line";

/** One badge: an optional icon, a text, and a longer label for the tooltip. */
export function badge(parent: HTMLElement, icon: string | null, text: string, label: string | null, cls = ""): HTMLElement {
  const el = parent.createSpan({ cls: `ps-badge ${cls}`.trim() });
  if (label) el.setAttr("aria-label", label);
  if (icon) setIcon(el.createSpan("ps-badge-icon"), icon);
  el.createSpan({ text });
  return el;
}

/** How a clickable badge row changes its task. */
export interface BadgeEdits {
  app: App;
  /** Rewrite the task's text (what follows "- [ ] ") and save it. */
  change(edit: (text: string) => string): void;
  /** The task's status character, and how to set it (" " open, "/" in progress, "-" cancelled). */
  status: string;
  setStatus(status: string): void;
  /** Open the Tasks plugin's Edit dialog on the task; absent without Tasks. */
  inTasks?: () => void;
}

/**
 * A task's details as badges: priority, dates (relative to `today`),
 * recurrence, tags. Shared by the Tasks page, board cards and notes.
 * `fallback`: dates known from elsewhere, for a task whose text doesn't
 * carry them. With `edits`, each badge opens a menu that changes its field,
 * and a + after them adds one.
 */
export function taskBadges(
  parent: HTMLElement,
  details: TaskDetails,
  closed: boolean,
  today: string,
  fallback: { due?: string | null; done?: string | null } = {},
  edits?: BadgeEdits
): void {
  const before = parent.childElementCount;
  const editable = (el: HTMLElement, kind: EditableField | "tag", current: string | null) => {
    if (edits) clickable(el, () => fieldMenu(el, kind, current, today, edits));
  };
  const priority = PRIORITIES.find((p) => p.value === details.priority);
  if (priority) {
    editable(badge(parent, "flag", priority.label, `${priority.label} priority`, `is-priority-${priority.value}`), "priority", priority.value);
  }
  const due = details.due ?? fallback.due;
  if (due && !closed) {
    const el = badge(parent, "calendar", dueDateLabel(due, today), `Due ${due}`);
    el.toggleClass("is-overdue", due < today);
    el.toggleClass("is-today", due === today);
    editable(el, "due", details.due);
  }
  if (details.scheduled && !closed) {
    const el = badge(parent, "calendar-clock", dueDateLabel(details.scheduled, today), `Scheduled ${details.scheduled}`);
    el.toggleClass("is-today", details.scheduled === today);
    editable(el, "scheduled", details.scheduled);
  }
  // A start date matters only until it's reached.
  if (details.start && !closed && details.start > today) {
    editable(badge(parent, "calendar-plus", dueDateLabel(details.start, today), `Starts ${details.start}`), "start", details.start);
  }
  if (details.recurrence) {
    editable(badge(parent, "repeat", details.recurrence, `Repeats ${details.recurrence}`), "recurrence", details.recurrence);
  }
  const done = details.done ?? fallback.done;
  if (closed && done) badge(parent, "check", dueDateLabel(done, today), `Done ${done}`, "is-quiet");
  if (details.cancelled) badge(parent, "x", dueDateLabel(details.cancelled, today), `Cancelled ${details.cancelled}`, "is-quiet");
  for (const tag of details.badgeTags) editable(badge(parent, null, `#${tag}`, null, "ps-badge-tag"), "tag", tag);

  // shortcut: + only joins a row that has badges; a task without fields gets one by typing or Edit in Tasks.
  if (edits && !closed && parent.childElementCount > before) {
    const add = badge(parent, "plus", "", "Add", "ps-badge-add");
    clickable(add, () => addMenu(add, details, today, edits));
  }
}

/** A badge that opens its menu on click, Enter or Space, without reaching what it sits on. */
function clickable(el: HTMLElement, open: () => void): void {
  el.addClass("is-clickable");
  el.setAttrs({ role: "button", tabindex: "0" });
  el.addEventListener("mousedown", (evt) => evt.stopPropagation());
  el.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    open();
  });
  el.addEventListener("keydown", (evt) => {
    if (evt.key !== "Enter" && evt.key !== " ") return;
    evt.preventDefault();
    evt.stopPropagation();
    open();
  });
}

function showUnder(menu: Menu, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WHEN_DONE = /\s+when done\s*$/i;

const HEADINGS: Record<EditableField, [string, string]> = {
  due: ["Due date", "calendar"],
  scheduled: ["Scheduled date", "calendar-clock"],
  start: ["Start date", "calendar-plus"],
  priority: ["Priority", "flag"],
  recurrence: ["Repeat", "repeat"],
};

/** The menu for one field: its name, its choices, Remove, and Edit in Tasks. */
function fieldMenu(anchor: HTMLElement, kind: EditableField | "tag", current: string | null, today: string, edits: BadgeEdits): void {
  const set = (value: string | null) => edits.change((text) => setTaskField(text, kind, value));
  // Where the badge is now: by the time a date is picked it may have been drawn again, or gone.
  const at = anchor.getBoundingClientRect();
  const menu = new Menu();
  // Which detail this is, as a heading.
  const [title, icon] = kind === "tag" ? [`Tag #${current}`, "tag"] : HEADINGS[kind];
  menu.addItem((i) => i.setTitle(title).setIcon(icon).setIsLabel(true));
  menu.addSeparator();
  if (kind === "due" || kind === "scheduled" || kind === "start") {
    for (const p of duePresets(today)) {
      menu.addItem((i) => i.setTitle(p.label).setChecked(current === p.date).onClick(() => set(p.date)));
    }
    menu.addItem((i) => i.setTitle("Pick a date…").onClick(() => pickDate(at, current, set)));
  } else if (kind === "priority") {
    for (const p of PRIORITIES) {
      menu.addItem((i) => i.setTitle(p.label).setChecked(current === p.value).onClick(() => set(p.value)));
    }
  } else if (kind === "recurrence") {
    const whenDone = !!current && WHEN_DONE.test(current);
    const base = current?.replace(WHEN_DONE, "") ?? null;
    for (const r of RECURRENCES) {
      menu.addItem((i) => i.setTitle(capitalize(r)).setChecked(base === r).onClick(() => set(whenDone ? `${r} when done` : r)));
    }
    if (base) {
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Count from when it's done")
          .setChecked(whenDone)
          .onClick(() => set(whenDone ? base : `${base} when done`))
      );
    }
  }
  if (current !== null) {
    if (kind !== "tag") menu.addSeparator();
    menu.addItem((i) => i.setTitle("Remove").setIcon("trash-2").onClick(() => set(kind === "tag" ? current : null)));
  }
  inTasksItem(menu, edits);
  showUnder(menu, anchor);
}

/** The + menu: the fields the task doesn't have yet. */
function addMenu(anchor: HTMLElement, details: TaskDetails, today: string, edits: BadgeEdits): void {
  const menu = new Menu();
  for (const [kind, [title, icon]] of Object.entries(HEADINGS) as [EditableField, [string, string]][]) {
    if (details[kind] !== null) continue;
    // After this menu has closed, so the next one isn't closed with it.
    menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => window.setTimeout(() => fieldMenu(anchor, kind, null, today, edits))));
  }
  menu.addItem((i) => i.setTitle("Tag…").setIcon("tag").onClick(() => addTag(edits, details)));
  menu.addSeparator();
  // Picking the status the task has puts it back to open.
  const status = (value: string, title: string, icon: string) =>
    menu.addItem((i) =>
      i
        .setTitle(title)
        .setIcon(icon)
        .setChecked(edits.status === value)
        .onClick(() => edits.setStatus(edits.status === value ? " " : value))
    );
  status("/", "In progress", "circle-dot");
  status("-", "Cancelled", "circle-slash");
  inTasksItem(menu, edits);
  showUnder(menu, anchor);
}

/** Ask for a tag, suggesting the vault's, and add it to the task. */
function addTag(edits: BadgeEdits, details: TaskDetails): void {
  // getTags is Obsidian's, not in its typings: "#tag" → count, for the suggestions.
  const cache = edits.app.metadataCache as unknown as { getTags?(): Record<string, number> };
  const existing = Object.keys(cache.getTags?.() ?? {}).map((t) => t.replace(/^#/, ""));
  new TagModal(edits.app, details.description, existing, (tag) => edits.change((text) => addTaskTag(text, tag))).open();
}

function inTasksItem(menu: Menu, edits: BadgeEdits): void {
  if (!edits.inTasks) return;
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Edit in Tasks…").setIcon("pencil").onClick(() => edits.inTasks!()));
}

/** The system date picker under the badge (`at`): an invisible input there, opened through showPicker(). */
function pickDate(at: DOMRect, current: string | null, set: (date: string) => void): void {
  // One left behind by a picker that was dismissed.
  document.querySelectorAll(".ps-badge-date").forEach((el) => el.remove());
  const input = document.body.createEl("input", { type: "date", cls: "ps-badge-date", attr: { tabindex: "-1" } });
  input.style.left = `${at.left}px`;
  input.style.top = `${at.top}px`;
  input.style.height = `${at.height}px`;
  input.value = current ?? "";
  input.addEventListener("change", () => {
    if (input.value) set(input.value);
    input.remove();
  });
  try {
    input.showPicker();
  } catch {
    input.remove();
  }
}
