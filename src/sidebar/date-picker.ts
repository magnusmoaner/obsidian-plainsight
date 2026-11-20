import { App, Scope, setIcon } from "obsidian";
import { addDays } from "./core/queries";
import { addMonths, monthGrid } from "./core/task-line";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** Closes the calendar that's open, so only one is. */
let closeOpen: (() => void) | null = null;

/** The same day `months` away, or that month's last day if it has fewer. */
const shift = (date: string, months: number) => {
  const first = addMonths(date, months);
  const last = addDays(addMonths(first, 1), -1);
  return `${first.slice(0, 8)}${String(Math.min(Number(date.slice(8)), Number(last.slice(8)))).padStart(2, "0")}`;
};
const label = (date: string, opts: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00`).toLocaleDateString("en", opts);

/**
 * Plainsight's calendar under `at` (the system one can't be styled). It wears
 * Obsidian's menu look. Arrow keys move, Page Up/Down change month, Enter
 * picks; Escape or a click outside closes it.
 */
export function openDatePicker(
  app: App,
  at: DOMRect,
  current: string | null,
  today: string,
  pick: (date: string) => void,
  onClose?: () => void
): void {
  closeOpen?.();
  const el = document.body.createDiv({ cls: "menu ps-date-picker", attr: { role: "dialog", "aria-label": "Pick a date" } });
  let focus = current ?? today;

  const head = el.createDiv("ps-date-picker-head");
  const title = head.createDiv("ps-date-picker-title");
  const step = (icon: string, name: string, months: number) => {
    const b = head.createDiv({ cls: "clickable-icon", attr: { role: "button", "aria-label": name } });
    setIcon(b, icon);
    b.addEventListener("click", () => {
      focus = shift(focus, months);
      draw(false);
    });
  };
  step("chevron-left", "Previous month", -1);
  step("chevron-right", "Next month", 1);
  const grid = el.createDiv({ cls: "ps-date-picker-grid", attr: { role: "grid" } });

  const outside = (evt: PointerEvent) => {
    if (!el.contains(evt.target as Node)) close();
  };
  // Its own key scope while open, so Escape closes the calendar and not a dialog under it.
  const scope = new Scope(app.scope);
  scope.register([], "Escape", () => {
    close();
    return false;
  });
  app.keymap.pushScope(scope);
  const close = () => {
    if (!el.isConnected) return;
    app.keymap.popScope(scope);
    el.remove();
    document.removeEventListener("pointerdown", outside, true);
    if (closeOpen === close) closeOpen = null;
    onClose?.();
  };
  closeOpen = close;
  const choose = (date: string) => {
    close();
    pick(date);
  };

  const draw = (moveFocus: boolean) => {
    grid.empty();
    title.setText(label(focus, { month: "long", year: "numeric" }));
    for (const w of WEEKDAYS) grid.createDiv({ cls: "ps-date-picker-weekday", text: w });
    const month = focus.slice(0, 7);
    for (const day of monthGrid(focus)) {
      const cell = grid.createDiv({
        cls: "ps-date-picker-day",
        text: String(Number(day.slice(8))),
        attr: { role: "gridcell", tabindex: day === focus ? "0" : "-1", "aria-label": label(day, { dateStyle: "full" }) },
      });
      cell.toggleClass("is-outside", day.slice(0, 7) !== month);
      cell.toggleClass("is-today", day === today);
      cell.toggleClass("is-selected", day === current);
      if (day === current) cell.setAttr("aria-selected", "true");
      cell.addEventListener("click", () => choose(day));
      if (moveFocus && day === focus) cell.focus({ preventScroll: true });
    }
  };

  el.addEventListener("keydown", (evt) => {
    const move = STEPS[evt.key];
    if (move) focus = addDays(focus, move);
    else if (evt.key === "PageUp" || evt.key === "PageDown") focus = shift(focus, evt.key === "PageUp" ? -1 : 1);
    else if (evt.key === "Enter" || evt.key === " ") choose(focus);
    else return;
    evt.preventDefault();
    evt.stopPropagation();
    if (el.isConnected) draw(true);
  });

  draw(true);
  // Under `at`, or above it when there's no room below; kept inside the window.
  const { width, height } = el.getBoundingClientRect();
  const below = at.bottom + 4;
  el.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`;
  el.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, at.top - height - 4) : below}px`;
  document.addEventListener("pointerdown", outside, true);
}
