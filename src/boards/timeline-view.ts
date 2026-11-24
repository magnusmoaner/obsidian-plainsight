import { App, Notice, TFile } from "obsidian";
import { dragCopy, draggedTask, moveTaskOut, setDraggedTask } from "../drag";
import { localISODate } from "../sidebar/core/format";
import { TaskFormat } from "../sidebar/core/task-fields";
import { taskAsCard } from "../sidebar/core/task-move";
import { matchTaskLine } from "../sidebar/core/tasks";
import { dragAction, startBoardDrag } from "../sidebar/internals";
import { Board, CardRef, editCard, insertCard, isDone, LaneRef, TasksToggle } from "./board";
import { bucketsFor, dayNumber, moveCardDates, Placement, placeCard, stackBoxes, Unit, unitFor, weekday } from "./timeline";

/** A column's width: a board list's. */
const COL = 250;
/** Space between cards. */
const GAP = 8;

/** What the timeline keeps between redraws of its board. */
export interface TimelineState {
  /** Days, weeks or months as columns; null to suit the board's dates. */
  zoom: Unit | null;
  /** How far it's scrolled; null to start at today. */
  scroll: number | null;
  /** Stops watching the cards' sizes. */
  stop?: () => void;
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
 * The board's cards placed in time, in columns of days, weeks or months:
 * each drawn as on the board, in the column of its date (across several,
 * if it runs that long), edged in its list's colour. Within a column, cards
 * go in date order. Cards with no dates wait in a tray underneath. Dragging a
 * card moves its dates. A card can also be dragged
 * out into a note, as from the board, and a task dragged in from a note
 * lands on the day it's dropped on, in the first list.
 */
export function renderTimeline(parent: HTMLElement, host: TimelineHost, state: TimelineState): void {
  state.stop?.();
  const root = parent.createDiv("psb-timeline");
  const today = dayNumber(localISODate());

  const marks: Mark[] = [];
  host.board.lanes.forEach((lane, l) =>
    lane.cards.forEach((c, i) => {
      const finished = isDone(c.check) || c.check === "-";
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

  /** The columns drawn, as first and last day numbers. */
  let cols: { start: number; end: number }[] = [];
  /** The column a day is in; the first or last for a day before or after them all. */
  const colOf = (day: number) => {
    const i = cols.findIndex((c) => day <= c.end);
    return i < 0 ? cols.length - 1 : Math.max(0, day < cols[0].start ? 0 : i);
  };
  /** Where a day starts, in pixels from the left: its column's share of it. */
  const xOf = (day: number) => {
    const i = colOf(day);
    const c = cols[i];
    return i * COL + (Math.min(Math.max(day, c.start), c.end + 1) - c.start) * (COL / (c.end - c.start + 1));
  };
  /** The day at `px` from the left. */
  const dayAtX = (px: number) => {
    const i = Math.min(cols.length - 1, Math.max(0, Math.floor(px / COL)));
    const c = cols[i];
    return c.start + Math.min(c.end - c.start, Math.floor(((px - i * COL) / COL) * (c.end - c.start + 1)));
  };
  /** The card being dragged from this timeline. */
  let grab: { mark: Mark; width: number; height: number } | null = null;
  let slot: HTMLElement | null = null;

  const draw = () => {
    state.stop?.();
    root.empty();

    const dates = marks.flatMap((m) => (m.place ? [dayNumber(m.place.from), dayNumber(m.place.to)] : []));
    const lo = Math.min(today, ...dates);
    const hi = Math.max(today, ...dates);
    const unit = state.zoom ?? unitFor(lo, hi);
    const bar = root.createDiv("psb-tl-bar");
    const zooms: [Unit, string][] = [["day", "Days"], ["week", "Weeks"], ["month", "Months"]];
    segmented(bar, zooms, unit, (zoom) => {
      state.zoom = zoom;
      state.scroll = null;
      draw();
    });

    // A little room before the first date, and enough columns to fill the width.
    const width = Math.max(COL, parent.clientWidth || 700);
    cols = bucketsFor(unit, unit === "day" ? lo - 1 : lo, hi, Math.ceil(width / COL));

    const scroll = root.createDiv("psb-tl-scroll");
    const grid = scroll.createDiv("psb-tl-grid");
    grid.style.width = `${cols.length * COL}px`;
    grid.style.setProperty("--psb-tl-col", `${COL}px`);

    const heads = grid.createDiv("psb-tl-heads");
    for (const c of cols) {
      const head = heads.createDiv("psb-tl-head");
      head.toggleClass("is-today", c.start <= today && today <= c.end);
      head.toggleClass("is-weekend", unit === "day" && weekday(c.start) >= 5);
      const [title, sub] =
        unit === "day"
          ? [dayLabel(c.start, { weekday: "short", day: "numeric" }), dayLabel(c.start, { month: "long" })]
          : unit === "week"
            ? [dayLabel(c.start, { month: "short", day: "numeric" }), `to ${dayLabel(c.end, { month: "short", day: "numeric" })}`]
            : [dayLabel(c.start, { month: "long" }), dayLabel(c.start, { year: "numeric" })];
      head.createDiv({ cls: "psb-tl-head-title", text: title });
      head.createDiv({ cls: "psb-tl-head-sub", text: sub });
    }

    const track = grid.createDiv("psb-tl-track");
    if (cols.length && today >= cols[0].start) track.createDiv("psb-tl-now").style.left = `${(xOf(today) + xOf(today + 1)) / 2}px`;
    // In date order, so a column's cards stack earliest first.
    const items = marks
      .filter((m) => m.place)
      .sort((a, b) => a.place!.from.localeCompare(b.place!.from) || a.place!.to.localeCompare(b.place!.to))
      .map((m) => {
        const place = m.place!;
        const from = dayNumber(place.from);
        const to = dayNumber(place.to);
        const item = cardEl(track, m, 0);
        const [left, width] = span(item, from, to);
        return { item, from: left, width };
      });
    dropTarget(track);

    // Cards are as tall as their text: stack them once drawn, and again when one changes size (as when it's edited).
    const layout = () => {
      const tops = stackBoxes(
        items.map(({ item, from, width }) => [from, from + width, item.offsetHeight]),
        GAP
      );
      let bottom = 0;
      items.forEach(({ item }, i) => {
        item.style.top = `${tops[i] + GAP}px`;
        bottom = Math.max(bottom, tops[i] + item.offsetHeight);
      });
      track.style.height = `${Math.max(bottom, 40) + 2 * GAP}px`;
    };
    layout();
    const win = root.win;
    let queued = 0;
    const watch = new ResizeObserver(() => {
      if (!queued) queued = win.requestAnimationFrame(() => ((queued = 0), layout()));
    });
    items.forEach(({ item }) => watch.observe(item));
    state.stop = () => {
      watch.disconnect();
      if (queued) win.cancelAnimationFrame(queued);
    };

    const undated = marks.filter((m) => !m.place && !m.finished);
    if (undated.length) {
      const tray = root.createDiv("psb-tl-tray");
      tray.createDiv({ cls: "psb-tl-tray-label", text: "No date" });
      const cards = tray.createDiv("psb-tl-tray-cards");
      for (const m of undated) cardEl(cards, m, COL - GAP);
    }

    // Opens on the column before today's, so what's next is in view.
    scroll.addEventListener("scroll", () => (state.scroll = scroll.scrollLeft));
    scroll.scrollLeft = state.scroll ?? Math.max(0, (colOf(today) - 1) * COL);
  };

  /** A card as on the board, edged in its list's colour. */
  function cardEl(parent: HTMLElement, m: Mark, width: number): HTMLElement {
    const item = parent.createDiv("psb-tl-item");
    item.style.width = `${width}px`;
    const colour = host.board.lanes[m.lane].colour;
    if (colour && host.coloured) item.dataset.colour = colour;
    host.renderCard(item, m.lane, m.card, { start: (evt, el) => startDrag(evt, el, item, m), end: endDrag });
    return item;
  }

  /** Places a card across the columns holding the days `from` to `to`; returns its left and width. */
  function span(item: HTMLElement, from: number, to: number): [number, number] {
    const left = colOf(from) * COL + GAP / 2;
    const width = (colOf(to) - colOf(from) + 1) * COL - GAP;
    item.style.left = `${left}px`;
    item.style.width = `${width}px`;
    return [left, width];
  }

  // ---- Dragging ---------------------------------------------------------

  function startDrag(evt: DragEvent, el: HTMLElement, item: HTMLElement, m: Mark): void {
    evt.stopPropagation();
    grab = { mark: m, width: item.offsetWidth, height: el.offsetHeight };
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
    slot?.remove();
    slot = null;
  }

  /** The card a drop is about: one of this board's, dragged here or from the board itself. */
  function draggedMark(): Mark | null {
    if (grab) return grab.mark;
    const task = draggedTask();
    const card = task?.path === host.file.path ? task.card : undefined;
    return card ? (marks.find((m) => m.lane === card.lane && m.card === card.card && m.ref.raw === card.raw) ?? null) : null;
  }

  function dropTarget(track: HTMLElement): void {
    // The day under the pointer: a dropped card starts there.
    const dayAt = (evt: DragEvent) => dayAtX(evt.clientX - track.getBoundingClientRect().left);
    track.addEventListener("dragover", (evt) => {
      const m = draggedMark();
      if (!m && !draggedTask()) return;
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      const day = dayAt(evt);
      if (!slot) slot = createDiv("psb-tl-slot");
      if (slot.parentElement !== track) track.appendChild(slot);
      slot.style.left = `${colOf(day) * COL + GAP / 2}px`;
      slot.style.width = `${grab?.width ?? COL - GAP}px`;
      slot.style.height = `${grab?.height ?? 40}px`;
      const date = dayLabel(day, { month: "short", day: "numeric" });
      const kind = m?.place?.kind;
      const hint = m?.finished ? "Done cards keep their dates" : kind === "bar" || kind === "start" ? `Starts ${date}` : kind === "scheduled" ? `Scheduled ${date}` : `Due ${date}`;
      dragAction(host.app, hint);
    });
    track.addEventListener("dragleave", (evt) => {
      if (slot && !(evt.relatedTarget instanceof Node && track.contains(evt.relatedTarget))) slot.remove();
    });
    track.addEventListener("drop", (evt) => {
      const m = draggedMark();
      const task = draggedTask();
      if (!m && !task) return;
      evt.preventDefault();
      evt.stopPropagation();
      const day = dayAt(evt);
      endDrag();
      if (m) {
        const [line, ...rest] = m.text.split("\n");
        const next = moveCardDates(line, m.place, day, host.format);
        if (next !== line) void host.write((t) => editCard(t, m.ref, [next, ...rest].join("\n")));
        return;
      }
      if (task!.path === host.file.path) return void new Notice("That task is in this board's file already.");
      const lane = host.board.lanes[0];
      if (!lane) return void new Notice("The board has no lists to put the task in.");
      void moveTaskOut(host.app, task!, async (block) => {
        const { check, body } = taskAsCard(block);
        const [line, ...rest] = body.split("\n");
        const dated = [moveCardDates(line, placeCard(line, false), day, host.format), ...rest].join("\n");
        const to: LaneRef = { lane: 0, raw: host.lines[lane.line] };
        if (!(await host.write((t) => insertCard(t, to, lane.cards.length, dated, check, host.viaTasks)))) throw new Error("the board changed");
      });
    });
  }

  draw();
}
