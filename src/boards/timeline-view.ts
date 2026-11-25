import { App, Menu, Notice, setIcon, TFile } from "obsidian";
import { dragCopy, draggedTask, moveTaskOut, setDraggedTask } from "../drag";
import { localISODate } from "../sidebar/core/format";
import { setTaskField, TaskFormat } from "../sidebar/core/task-fields";
import { taskAsCard } from "../sidebar/core/task-move";
import { matchTaskLine } from "../sidebar/core/tasks";
import { openDatePicker } from "../sidebar/date-picker";
import { dragAction, startBoardDrag } from "../sidebar/internals";
import { Board, CardRef, editCard, insertCard, isDone, LaneRef, TasksToggle } from "./board";
import { bucketAt, dayNumber, isoDay, moveCardDates, Placement, placeCard, timelineDay, Unit, unitFor } from "./timeline";

/** What the timeline keeps between redraws of its board. */
export interface TimelineState {
  /** Cards grouped by day, week, month or year, as picked under View; null to suit the board's dates. */
  zoom: Unit | null;
  /** How far it's scrolled; null to start at today. */
  scroll: number | null;
}

/** What dragging a card does, given to the board's card drawing. */
export interface CardDrag {
  start(evt: DragEvent, el: HTMLElement): void;
  end(): void;
}

/** What the timeline needs of the board it's drawn for. */
export interface TimelineHost {
  app: App;
  file: TFile;
  lines: string[];
  board: Board;
  /** List colours are shown: a Plainsight board. */
  coloured: boolean;
  /** Done and cancelled cards are shown, on the day they were finished. */
  showDone: boolean;
  /** The format new task fields are written in. */
  format: TaskFormat;
  write(op: (text: string) => string): Promise<boolean>;
  viaTasks: TasksToggle;
  /** Draw a card as the board does, with the timeline's own dragging. */
  renderCard(parent: HTMLElement, lane: number, card: number, drag: CardDrag): HTMLElement;
}

interface Mark {
  lane: number;
  card: number;
  ref: CardRef;
  /** The card's first line in the board's file. */
  line: number;
  text: string;
  place: Placement | null;
  /** The day it's grouped on (see timelineDay); null under No date. */
  day: number | null;
  finished: boolean;
}

const dayLabel = (day: number, opts: Intl.DateTimeFormatOptions) => new Date(day * 86400000).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

/**
 * The board's cards placed in time: grouped by the day, week or month they
 * are due in (or start, are scheduled or were done in, without a due date), each group drawn as a list on
 * the board, with its cards in date order, each with its own list's name
 * along its foot. Only groups with cards are shown; cards with no dates come first,
 * under "No date". Dropping a card sets its due date: on a day, that day; on
 * a week or a month, a menu asks which day; between two groups, a date is
 * picked; on No date, the due date goes.
 * A card can also be dragged out into a note, as from the board, and a task
 * dragged in from a note lands in the group it's dropped on, in the first list.
 */
export function renderTimeline(parent: HTMLElement, host: TimelineHost, state: TimelineState): Unit {
  const root = parent.createDiv("psb-timeline");
  const today = dayNumber(localISODate());

  const marks: Mark[] = [];
  host.board.lanes.forEach((lane, l) =>
    lane.cards.forEach((c, i) => {
      const finished = isDone(c.check) || c.check === "-";
      if (finished && !host.showDone) return;
      const place = placeCard(c.text.split("\n")[0], finished);
      marks.push({
        lane: l,
        card: i,
        ref: { lane: l, card: i, raw: host.lines[c.line] },
        line: c.line,
        text: c.text,
        place,
        day: place ? dayNumber(timelineDay(place)) : null,
        finished,
      });
    })
  );
  /** The card being dragged from this timeline. */
  let grab: Mark | null = null;

  const draw = (): Unit => {
    const dated = marks.filter((m) => m.day !== null).sort((a, b) => a.day! - b.day!);
    const days = dated.map((m) => m.day!);
    const unit = state.zoom ?? unitFor(Math.min(today, ...days), Math.max(today, ...days));

    // The groups with cards in them, in date order (the cards are already).
    const groups = new Map<number, { start: number; end: number; marks: Mark[] }>();
    for (const m of dated) {
      const g = bucketAt(unit, m.day!);
      if (!groups.has(g.start)) groups.set(g.start, { ...g, marks: [] });
      groups.get(g.start)!.marks.push(m);
    }

    const scroll = root.createDiv("psb-tl-scroll");
    // Always there, empty too: dropping a card here takes its due date away.
    const undated = list(scroll, "No date", marks.filter((m) => m.day === null && !m.finished));
    undated.addClass("is-undated");
    dropTarget(undated, null, "Remove the due date");
    // Time with no cards (before the first group, between two, after the last): a narrow strip to drop a card on and pick a date in it.
    const all = [...groups.values()];
    if (all.length) gap(scroll, "Earlier", Math.min(today, all[0].start - 1));
    else gap(scroll, "Pick a date", today);
    let before: number | null = null;
    const lanes = all.map((g) => {
      if (before !== null && g.start > before + 1) gap(scroll, rangeTitle(unit, before + 1, g.start - 1), before + 1);
      before = g.end;
      const title = groupTitle(unit, g.start, g.end);
      const lane = list(scroll, title, g.marks);
      lane.toggleClass("is-today", g.start <= today && today <= g.end);
      dropTarget(lane, { unit, ...g }, unit === "day" ? `Due ${dayLabel(g.start, { month: "short", day: "numeric" })}` : `Due in ${title}`);
      return { lane, end: g.end };
    });
    if (before !== null) gap(scroll, "Later", before + 1);

    // Opens on the group before today's (or the next one), so what's next is in view.
    scroll.addEventListener("scroll", () => (state.scroll = scroll.scrollLeft));
    const next = Math.max(0, lanes.findIndex((l) => l.end >= today) - 1);
    scroll.scrollLeft = state.scroll ?? (lanes.length ? lanes[next].lane.offsetLeft - undated.offsetLeft : 0);
    return unit;
  };

  /** A group, drawn as a list on the board: its name and count, then its cards. */
  function list(parent: HTMLElement, title: string, ms: Mark[]): HTMLElement {
    const lane = parent.createDiv("psb-lane");
    const head = lane.createDiv("psb-lane-head");
    head.createDiv({ cls: "psb-lane-title", text: title });
    head.createSpan({ cls: "psb-lane-count", text: String(ms.length) });
    const cards = lane.createDiv("psb-cards");
    for (const m of ms) cardEl(cards, m);
    return lane;
  }

  /** A card as on the board, with the name of its list along its foot, in that list's colour. */
  function cardEl(parent: HTMLElement, m: Mark): void {
    const item = parent.createDiv("psb-tl-item");
    const lane = host.board.lanes[m.lane];
    if (lane.colour && host.coloured) item.dataset.colour = lane.colour;
    const card = host.renderCard(item, m.lane, m.card, { start: (evt, el) => startDrag(evt, el, m), end: endDrag });
    card.createDiv({ cls: "psb-tl-list", text: lane.title });
  }

  // ---- Dragging ---------------------------------------------------------

  function startDrag(evt: DragEvent, el: HTMLElement, m: Mark): void {
    evt.stopPropagation();
    grab = m;
    // Something that isn't text, so a drop in a note types nothing.
    evt.dataTransfer?.setData("application/x-plainsight-board", "1");
    dragCopy(
      evt,
      el,
      (ghost) => {
        ghost.el.addClass("psb-board");
        return startBoardDrag(host.app, evt, ghost) || true;
      },
      undefined,
      () => setDraggedTask(null)
    );
    // A card is a task line in the board's file: it can be dropped in a note, or on a board.
    const task = matchTaskLine(m.ref.raw);
    if (task) setDraggedTask({ path: host.file.path, ref: { line: m.line, ...task }, card: m.ref });
    if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
    // After the browser has taken its picture of the card: an empty place is left where it was, until it's dropped.
    const item = el.parentElement;
    requestAnimationFrame(() => grab === m && item?.addClass("is-dragging"));
  }

  function endDrag(): void {
    grab = null;
    root.querySelectorAll(".is-drop-target, .is-dragging").forEach((el) => el.removeClasses(["is-drop-target", "is-dragging"]));
  }

  /** The card a drop is about: one of this board's, dragged here or from the board itself. */
  function draggedMark(): Mark | null {
    if (grab) return grab;
    const task = draggedTask();
    const card = task?.path === host.file.path ? task.card : undefined;
    return card ? (marks.find((m) => m.lane === card.lane && m.card === card.card && m.ref.raw === card.raw) ?? null) : null;
  }

  /**
   * Where a card or a task from a note can be dropped: on a group (`group`),
   * on No date (null), or on the time between two groups ("pick"). A card
   * dropped where it already is stays as it is.
   */
  function dropTarget(el: HTMLElement, group: { unit: Unit; start: number; end: number } | null | "pick", hint: string): void {
    const here = (m: Mark | null) =>
      !!m && (group === null ? m.day === null : group !== "pick" && m.day !== null && group.start <= m.day && m.day <= group.end);
    el.addEventListener("dragover", (evt) => {
      const m = draggedMark();
      if (!m && !draggedTask()) return;
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      el.addClass("is-drop-target");
      dragAction(host.app, m?.finished ? "Done cards keep their dates" : here(m) ? "It's here already" : hint);
    });
    el.addEventListener("dragleave", (evt) => {
      if (!(evt.relatedTarget instanceof Node && el.contains(evt.relatedTarget))) el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (evt) => {
      const m = draggedMark();
      const task = draggedTask();
      if (!m && !task) return;
      evt.preventDefault();
      evt.stopPropagation();
      endDrag();
      if (m?.finished || here(m)) return;
      if (!m && task!.path === host.file.path) return void new Notice("That task is in this board's file already.");
      const at = new DOMRect(evt.clientX, evt.clientY, 0, 0);
      const pick = (from: number) => openDatePicker(host.app, at, isoDay(from), localISODate(), (date) => place(m, task, dayNumber(date)));
      if (group === null) return place(m, task, null);
      if (group === "pick") return pick(Number(el.dataset.from));
      // A day is a date already; in a week or a month, which day is asked.
      if (group.unit === "day") return place(m, task, group.start);
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Due date").setIsLabel(true));
      menu.addSeparator();
      const choices: [string, number][] = [
        [`Start of the ${group.unit}`, group.start],
        [`Middle of the ${group.unit}`, group.start + Math.floor((group.end - group.start) / 2)],
        [`End of the ${group.unit}`, group.end],
      ];
      for (const [label, day] of choices) {
        const date = dayLabel(day, { weekday: "short", month: "short", day: "numeric", ...(group.unit === "year" && { year: "numeric" }) });
        menu.addItem((i) => i.setTitle(`${label}, ${date}`).onClick(() => place(m, task, day)));
      }
      menu.addItem((i) => i.setTitle("Pick a date…").onClick(() => pick(group.start)));
      menu.showAtMouseEvent(evt);
    });
  }

  /** Time with no cards, named `title`: a card dropped here gets a date picked, the picker opening on `from`. */
  function gap(parent: HTMLElement, title: string, from: number): void {
    const el = parent.createDiv({ cls: "psb-tl-gap", attr: { "aria-label": `${title}: drop a card here to pick its due date` } });
    setIcon(el.createSpan("psb-tl-gap-icon"), "calendar-plus");
    el.createSpan({ cls: "psb-tl-gap-title", text: title });
    el.dataset.from = String(from);
    dropTarget(el, "pick", `Pick a due date: ${title}`);
  }

  /** Gives a card of this board `day` as its due date (none for null), or brings a task in from a note so, into the first list. */
  function place(m: Mark | null, task: ReturnType<typeof draggedTask>, day: number | null): void {
    const due = (line: string, place: Placement | null) =>
      day === null ? setTaskField(line, "due", null, host.format) : moveCardDates(line, place, day, host.format);
    if (m) {
      const [line, ...rest] = m.text.split("\n");
      const next = due(line, m.place);
      if (next !== line) void host.write((t) => editCard(t, m.ref, [next, ...rest].join("\n")));
      return;
    }
    const first = host.board.lanes[0];
    if (!task || !first) return void new Notice("The board has no lists to put the task in.");
    void moveTaskOut(host.app, task, async (block) => {
      const { check, body } = taskAsCard(block);
      const [line, ...rest] = body.split("\n");
      const dated = [due(line, placeCard(line, false)), ...rest].join("\n");
      const to: LaneRef = { lane: 0, raw: host.lines[first.line] };
      if (!(await host.write((t) => insertCard(t, to, first.cards.length, dated, check, host.viaTasks)))) throw new Error("the board changed");
    });
  }

  return draw();
}

/** The time from `from` to `to`, whole groups of `unit`: "Thu, Nov 26", "Nov 26 – Dec 1", "December", "Dec – Feb", "2028" or "2028 – 2030". */
function rangeTitle(unit: Unit, from: number, to: number): string {
  if (unit === "year") {
    const year = (day: number) => isoDay(day).slice(0, 4);
    return year(from) === year(to) ? year(from) : `${year(from)} – ${year(to)}`;
  }
  if (unit === "month") {
    const month = (day: number, long: boolean) => dayLabel(day, { month: long ? "long" : "short" });
    return bucketAt("month", from).start === bucketAt("month", to).start ? month(from, true) : `${month(from, false)} – ${month(to, false)}`;
  }
  if (from === to) return dayLabel(from, { weekday: "short", month: "short", day: "numeric" });
  return `${dayLabel(from, { month: "short", day: "numeric" })} – ${dayLabel(to, { month: "short", day: "numeric" })}`;
}

/** A group's name: "Tue 24 Nov", "23–29 Nov", "November 2026" or "2026", as the locale writes them. */
function groupTitle(unit: Unit, start: number, end: number): string {
  if (unit === "day") return dayLabel(start, { weekday: "short", day: "numeric", month: "short" });
  if (unit === "week") return `${dayLabel(start, { day: "numeric", month: "short" })} – ${dayLabel(end, { day: "numeric", month: "short" })}`;
  if (unit === "month") return dayLabel(start, { month: "long", year: "numeric" });
  return isoDay(start).slice(0, 4);
}
