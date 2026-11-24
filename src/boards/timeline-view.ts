import { App, Notice, TFile } from "obsidian";
import { dragCopy, draggedTask, moveTaskOut, setDraggedTask } from "../drag";
import { localISODate } from "../sidebar/core/format";
import { TaskFormat } from "../sidebar/core/task-fields";
import { taskAsCard } from "../sidebar/core/task-move";
import { matchTaskLine } from "../sidebar/core/tasks";
import { dragAction, startBoardDrag } from "../sidebar/internals";
import { Board, CardRef, editCard, insertCard, isDone, LaneRef, TasksToggle } from "./board";
import { bucketAt, dayIn, dayNumber, moveCardDates, Placement, placeCard, Unit, unitFor } from "./timeline";

/** What the timeline keeps between redraws of its board. */
export interface TimelineState {
  /** Cards grouped by day, week or month; null to suit the board's dates. */
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
  finished: boolean;
}

/** A row of buttons, one of them on. */
export function segmented<T extends string>(parent: HTMLElement, options: [T, string][], current: T, pick: (value: T) => void): HTMLElement {
  const seg = parent.createDiv({ cls: "psb-seg", attr: { role: "group" } });
  for (const [value, label] of options) {
    const b = seg.createEl("button", { text: label, attr: { "aria-pressed": String(value === current) } });
    b.toggleClass("is-active", value === current);
    b.addEventListener("click", () => value !== current && pick(value));
  }
  return seg;
}

const dayLabel = (day: number, opts: Intl.DateTimeFormatOptions) => new Date(day * 86400000).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

/**
 * The board's cards placed in time: grouped by the day, week or month they
 * start in (or are due, scheduled or done), each group drawn as a list on
 * the board, with its cards in date order and edged in their own list's
 * colour. Only groups with cards are shown; cards with no dates come first,
 * under "No date". Dragging a card to another group moves its dates there.
 * A card can also be dragged out into a note, as from the board, and a task
 * dragged in from a note lands in the group it's dropped on, in the first list.
 */
export function renderTimeline(parent: HTMLElement, host: TimelineHost, state: TimelineState): void {
  const root = parent.createDiv("psb-timeline");
  const today = dayNumber(localISODate());

  const marks: Mark[] = [];
  host.board.lanes.forEach((lane, l) =>
    lane.cards.forEach((c, i) => {
      const finished = isDone(c.check) || c.check === "-";
      if (finished && !host.showDone) return;
      marks.push({
        lane: l,
        card: i,
        ref: { lane: l, card: i, raw: host.lines[c.line] },
        line: c.line,
        text: c.text,
        place: placeCard(c.text.split("\n")[0], finished),
        finished,
      });
    })
  );
  /** The card being dragged from this timeline. */
  let grab: Mark | null = null;

  const draw = () => {
    root.empty();
    const dated = marks
      .filter((m) => m.place)
      .sort((a, b) => a.place!.from.localeCompare(b.place!.from) || a.place!.to.localeCompare(b.place!.to));
    const days = dated.map((m) => dayNumber(m.place!.from));
    const unit = state.zoom ?? unitFor(Math.min(today, ...days), Math.max(today, ...days));
    const bar = root.createDiv("psb-tl-bar");
    const zooms: [Unit, string][] = [["day", "Days"], ["week", "Weeks"], ["month", "Months"]];
    segmented(bar, zooms, unit, (zoom) => {
      state.zoom = zoom;
      state.scroll = null;
      draw();
    });

    // The groups with cards in them, in date order (the cards are already).
    const groups = new Map<number, { start: number; end: number; marks: Mark[] }>();
    for (const m of dated) {
      const g = bucketAt(unit, dayNumber(m.place!.from));
      if (!groups.has(g.start)) groups.set(g.start, { ...g, marks: [] });
      groups.get(g.start)!.marks.push(m);
    }

    const scroll = root.createDiv("psb-tl-scroll");
    const undated = marks.filter((m) => !m.place && !m.finished);
    if (undated.length) list(scroll, "No date", undated).addClass("is-undated");
    const lanes = [...groups.values()].map((g) => {
      const lane = list(scroll, groupTitle(unit, g.start, g.end), g.marks);
      lane.toggleClass("is-today", g.start <= today && today <= g.end);
      dropTarget(lane, unit, g);
      return { lane, end: g.end };
    });
    if (!lanes.length && !undated.length) scroll.createDiv({ cls: "psb-tl-empty", text: "No cards yet." });

    // Opens on the group before today's (or the next one), so what's next is in view.
    scroll.addEventListener("scroll", () => (state.scroll = scroll.scrollLeft));
    const next = Math.max(0, lanes.findIndex((l) => l.end >= today) - 1);
    const first = scroll.firstElementChild as HTMLElement | null;
    scroll.scrollLeft = state.scroll ?? (first && lanes.length ? lanes[next].lane.offsetLeft - first.offsetLeft : 0);
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

  /** A card as on the board, edged in its list's colour. */
  function cardEl(parent: HTMLElement, m: Mark): void {
    const item = parent.createDiv("psb-tl-item");
    const colour = host.board.lanes[m.lane].colour;
    if (colour && host.coloured) item.dataset.colour = colour;
    host.renderCard(item, m.lane, m.card, { start: (evt, el) => startDrag(evt, el, m), end: endDrag });
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
  }

  function endDrag(): void {
    grab = null;
    root.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
  }

  /** The card a drop is about: one of this board's, dragged here or from the board itself. */
  function draggedMark(): Mark | null {
    if (grab) return grab;
    const task = draggedTask();
    const card = task?.path === host.file.path ? task.card : undefined;
    return card ? (marks.find((m) => m.lane === card.lane && m.card === card.card && m.ref.raw === card.raw) ?? null) : null;
  }

  /** The day a card lands on in `group`: as far in as it was in its own, or the group's first day. */
  const landing = (m: Mark | null, unit: Unit, group: { start: number; end: number }) =>
    m?.place ? dayIn(unit, dayNumber(m.place.from), group) : group.start;

  function dropTarget(lane: HTMLElement, unit: Unit, group: { start: number; end: number }): void {
    lane.addEventListener("dragover", (evt) => {
      const m = draggedMark();
      if (!m && !draggedTask()) return;
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      lane.addClass("is-drop-target");
      const date = dayLabel(landing(m, unit, group), { month: "short", day: "numeric" });
      const kind = m?.place?.kind;
      const hint = m?.finished ? "Done cards keep their dates" : kind === "bar" || kind === "start" ? `Starts ${date}` : kind === "scheduled" ? `Scheduled ${date}` : `Due ${date}`;
      dragAction(host.app, hint);
    });
    lane.addEventListener("dragleave", (evt) => {
      if (!(evt.relatedTarget instanceof Node && lane.contains(evt.relatedTarget))) lane.removeClass("is-drop-target");
    });
    lane.addEventListener("drop", (evt) => {
      const m = draggedMark();
      const task = draggedTask();
      if (!m && !task) return;
      evt.preventDefault();
      evt.stopPropagation();
      const day = landing(m, unit, group);
      endDrag();
      if (m) {
        const [line, ...rest] = m.text.split("\n");
        const next = moveCardDates(line, m.place, day, host.format);
        if (next !== line) void host.write((t) => editCard(t, m.ref, [next, ...rest].join("\n")));
        return;
      }
      if (task!.path === host.file.path) return void new Notice("That task is in this board's file already.");
      const first = host.board.lanes[0];
      if (!first) return void new Notice("The board has no lists to put the task in.");
      void moveTaskOut(host.app, task!, async (block) => {
        const { check, body } = taskAsCard(block);
        const [line, ...rest] = body.split("\n");
        const dated = [moveCardDates(line, placeCard(line, false), day, host.format), ...rest].join("\n");
        const to: LaneRef = { lane: 0, raw: host.lines[first.line] };
        if (!(await host.write((t) => insertCard(t, to, first.cards.length, dated, check, host.viaTasks)))) throw new Error("the board changed");
      });
    });
  }

  draw();
}

/** A group's name: "Tue 24 Nov", "23–29 Nov" or "November 2026", as the locale writes them. */
function groupTitle(unit: Unit, start: number, end: number): string {
  if (unit === "day") return dayLabel(start, { weekday: "short", day: "numeric", month: "short" });
  if (unit === "week") return `${dayLabel(start, { day: "numeric", month: "short" })} – ${dayLabel(end, { day: "numeric", month: "short" })}`;
  return dayLabel(start, { month: "long", year: "numeric" });
}
