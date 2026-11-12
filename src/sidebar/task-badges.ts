import { setIcon } from "obsidian";
import { dueDateLabel } from "./core/format";
import { TaskDetails } from "./core/task-details";
import { PRIORITIES } from "./core/task-line";

/** One badge: an optional icon, a text, and a longer label for the tooltip. */
export function badge(parent: HTMLElement, icon: string | null, text: string, label: string | null, cls = ""): HTMLElement {
  const el = parent.createSpan({ cls: `ps-badge ${cls}`.trim() });
  if (label) el.setAttr("aria-label", label);
  if (icon) setIcon(el.createSpan("ps-badge-icon"), icon);
  el.createSpan({ text });
  return el;
}

/**
 * A task's details as badges: priority, dates (relative to `today`),
 * recurrence, tags. Shared by the Tasks page and board cards. `fallback`:
 * dates known from elsewhere, for a task whose text doesn't carry them.
 */
export function taskBadges(
  parent: HTMLElement,
  details: TaskDetails,
  closed: boolean,
  today: string,
  fallback: { due?: string | null; done?: string | null } = {}
): void {
  const priority = PRIORITIES.find((p) => p.value === details.priority);
  if (priority) badge(parent, "flag", priority.label, `${priority.label} priority`, `is-priority-${priority.value}`);
  const due = details.due ?? fallback.due;
  if (due && !closed) {
    const el = badge(parent, "calendar", dueDateLabel(due, today), `Due ${due}`);
    el.toggleClass("is-overdue", due < today);
    el.toggleClass("is-today", due === today);
  }
  if (details.scheduled && !closed) {
    const el = badge(parent, "calendar-clock", dueDateLabel(details.scheduled, today), `Scheduled ${details.scheduled}`);
    el.toggleClass("is-today", details.scheduled === today);
  }
  // A start date matters only until it's reached.
  if (details.start && !closed && details.start > today) {
    badge(parent, "calendar-plus", dueDateLabel(details.start, today), `Starts ${details.start}`);
  }
  if (details.recurrence) badge(parent, "repeat", details.recurrence, `Repeats ${details.recurrence}`);
  const done = details.done ?? fallback.done;
  if (closed && done) badge(parent, "check", dueDateLabel(done, today), `Done ${done}`, "is-quiet");
  if (details.cancelled) badge(parent, "x", dueDateLabel(details.cancelled, today), `Cancelled ${details.cancelled}`, "is-quiet");
  for (const tag of details.badgeTags) badge(parent, null, `#${tag}`, null, "ps-badge-tag");
}
