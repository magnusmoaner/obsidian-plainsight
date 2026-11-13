import { folderNameError, setTextProperty } from "../sidebar/core/edits";
import { localISODate } from "../sidebar/core/format";
import { taskDetails } from "../sidebar/core/task-details";
import { badge, taskBadges } from "../sidebar/task-badges";
import { dragCopy, draggedTask, moveTaskOut } from "../drag";
import { taskAsCard } from "../sidebar/core/task-move";
import { dragAction, startBoardDrag, tasksToggle } from "../sidebar/internals";
import { CardEditor, openCardEditor } from "./card-editor";
import {
  App,
  Component,
  getFrontMatterInfo,
  Keymap,
  MarkdownRenderChild,
  MarkdownRenderer,
  Menu,
  Modal,
  normalizePath,
  Notice,
  PaneType,
  parseFrontMatterTags,
  parseYaml,
  setIcon,
  Setting,
  TFile,
} from "obsidian";
import {
  addCard,
  addLane,
  Board,
  cardDisplay,
  CardRef,
  deleteCard,
  deleteLane,
  editCard,
  insertCard,
  isDone,
  LaneRef,
  LIST_COLOURS,
  moveCard,
  moveLane,
  parseBoard,
  renameLane,
  setCardStatus,
  setLaneCollapsed,
  setLaneColour,
  setLaneStatus,
  StaleBoardError,
  toggleCard,
} from "./board";

type Drag = { kind: "card"; ref: CardRef } | { kind: "lane"; ref: LaneRef };

/** What a board on its own page asks of the plugin around it. */
export interface BoardHost {
  /** The notes that embed the board. */
  embeddedIn(board: TFile): TFile[];
  /** Ask for a tag and add it to the board's properties. */
  addTag(board: TFile): void;
  /** Ask for a note and embed the board at the end of it. */
  embedIn(board: TFile): void;
  /** Call `listener` when what's known about the vault's notes changes; returns how to stop. */
  onChange(listener: () => void): () => void;
}

/** Card statuses, as the Tasks plugin names them: character, label, icon. */
const STATUSES = [
  [" ", "Open", "circle"],
  ["/", "In progress", "circle-dot"],
  ["x", "Done", "check-circle-2"],
  ["-", "Cancelled", "minus-circle"],
] as const;

/**
 * A Kanban board drawn inside a note. It reads the board file, writes each
 * change straight back to it, and redraws whenever the file changes, from
 * here, from the Kanban plugin or from anywhere else.
 */
export class BoardView extends MarkdownRenderChild {
  private file: TFile | null = null;
  private lines: string[] = [];
  /** Markdown rendered into cards; replaced on every redraw. */
  private cards = new Component();
  private drag: Drag | null = null;
  /** Shows where the dragged card or list would land. */
  private slot: HTMLElement | null = null;
  /** A redraw that arrived while something was being typed. */
  private pending = false;
  /** The list whose "Add a card" box reopens after the next redraw. */
  private reopenAdd: number | null = null;
  /** A Plainsight board, whose lists can have colours. */
  private coloured = false;
  /** The notes the board was embedded in when its header was last drawn; null before that. */
  private embeddedKey: string | null = null;
  /** A list was just added: open its name for typing after the next redraw. */
  private nameNewList = false;

  constructor(
    private app: App,
    containerEl: HTMLElement,
    /** The board: a link as written in an embed block, or the file itself. */
    private target: string | TFile,
    private sourcePath: string,
    /** Open a board on its own page, or a note. */
    private open: (file: TFile, newLeaf: PaneType | boolean) => void,
    /** Given on the board's own page: it shows the board's description, tags and where it's embedded. */
    private host?: BoardHost
  ) {
    super(containerEl);
  }

  onload(): void {
    this.containerEl.addClass("psb-board");
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (f.path === this.file?.path) void this.refresh();
      })
    );
    // A renamed board keeps its file, so nothing above fires: redraw its name.
    this.registerEvent(
      this.app.vault.on("rename", (f) => {
        if (f === this.file) void this.refresh();
      })
    );
    // Where the board is embedded is read from other notes: redraw when that changes.
    if (this.host) {
      const host = this.host;
      this.register(
        host.onChange(() => {
          if (this.file && this.embeddedKey !== null && embedKey(host.embeddedIn(this.file)) !== this.embeddedKey) void this.refresh();
        })
      );
    }
    // The slot shown for a task dragged in from outside is taken away when
    // the pointer leaves the board, and when that drag ends anywhere.
    const doc = this.containerEl.doc;
    const leave = (evt: Event) => {
      if (this.drag || !this.slot) return;
      if (evt.type !== "dragover" || !(evt.target instanceof Node) || !this.containerEl.contains(evt.target)) this.endDrag();
    };
    for (const type of ["dragover", "dragend", "drop"] as const) {
      doc.addEventListener(type, leave, true);
      this.register(() => doc.removeEventListener(type, leave, true));
    }
    // Covers a board created, renamed or deleted after the note was opened.
    this.registerEvent(this.app.metadataCache.on("resolved", () => !this.file && void this.refresh()));
    void this.refresh();
  }

  onunload(): void {
    this.cards.unload();
  }

  /** Completing a card goes through the Tasks plugin when it's there: a done date, and a repeating card's next round. */
  private viaTasks = (line: string) => tasksToggle(this.app, line, this.file!.path);

  private async refresh(): Promise<void> {
    if (this.isTyping()) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.file =
      this.target instanceof TFile ? this.target : this.app.metadataCache.getFirstLinkpathDest(this.target, this.sourcePath);
    if (!this.file || !this.app.vault.getAbstractFileByPath(this.file.path)) return this.renderMissing();
    const text = await this.app.vault.cachedRead(this.file);
    this.lines = text.split(/\r?\n/);
    this.render(parseBoard(text), properties(text));
  }

  private isTyping(): boolean {
    const active = this.containerEl.ownerDocument.activeElement;
    return !!active && this.containerEl.contains(active) && active.matches("input, textarea, [contenteditable='true']");
  }

  /** After typing ends: catch up on a redraw that was held back. */
  private doneTyping(): void {
    if (this.pending) void this.refresh();
  }

  /** Change the board's file. False if the board had changed underneath, and nothing was written. */
  private async write(op: (text: string) => string): Promise<boolean> {
    if (!this.file) return false;
    try {
      await this.app.vault.process(this.file, op);
      return true;
    } catch (e) {
      if (!(e instanceof StaleBoardError)) throw e;
      new Notice("The board changed while you were working on it. Try again.");
      void this.refresh();
      return false;
    }
  }

  private renderMissing(): void {
    this.cards.unload();
    this.containerEl.empty();
    const name = this.target instanceof TFile ? this.target.path : this.target;
    this.containerEl.createDiv({ cls: "psb-missing", text: `Board not found: ${name}` });
  }

  private render(board: Board, props: Record<string, unknown>): void {
    // List colours belong to Plainsight's own boards. A Kanban plugin board
    // has none in that plugin, so none are shown or offered here either.
    this.coloured = props["plainsight-plugin"] !== undefined;
    const scroll = this.containerEl.querySelector(".psb-lanes")?.scrollLeft ?? 0;
    this.cards.unload();
    this.cards = new Component();
    this.cards.load();
    this.containerEl.empty();

    const file = this.file!;
    const count = board.lanes.reduce((n, l) => n + l.cards.length, 0);
    const cards = `${count} card${count === 1 ? "" : "s"}`;
    if (this.host) {
      this.renderAbout(this.host, props, cards);
    } else {
      const head = this.containerEl.createDiv("psb-head");
      const title = head.createEl("a", { cls: "psb-title internal-link", text: file.basename, href: file.path });
      title.addEventListener("click", (evt) => {
        evt.preventDefault();
        this.open(file, Keymap.isModEvent(evt));
      });
      head.createSpan({ cls: "psb-count", text: cards });
    }

    const lanesEl = this.containerEl.createDiv("psb-lanes");
    board.lanes.forEach((_, i) => this.renderLane(lanesEl, board, i));
    // Lists are added on the board's own page: here, or with the button in its header.
    if (this.host) this.renderAddLane(lanesEl);
    this.dropZone(lanesEl, lanesEl, ".psb-lane", "lane", "x", "Move the list here", (index) => {
      // Read now: the drag is over by the time the file is written.
      const drag = this.drag;
      if (drag?.kind === "lane") void this.write((t) => moveLane(t, drag.ref, index));
    });
    lanesEl.scrollLeft = scroll;
    if (this.nameNewList) {
      this.nameNewList = false;
      const titles = lanesEl.querySelectorAll<HTMLElement>(".psb-lane:not(.is-collapsed) > .psb-lane-head > .psb-lane-title");
      const last = titles[titles.length - 1];
      last?.scrollIntoView({ block: "nearest", inline: "nearest" });
      last?.click();
    }
    if (this.reopenAdd !== null) {
      lanesEl.children[this.reopenAdd]?.querySelector<HTMLElement>(".psb-add")?.click();
      this.reopenAdd = null;
    }
  }

  /** On the board's own page: its name and description, then its tags, the notes that embed it and the card count. */
  private renderAbout(host: BoardHost, props: Record<string, unknown>, cards: string): void {
    const file = this.file!;
    const about = this.containerEl.createDiv("psb-about");

    // The board's name is its file's name: typing a new one renames the file.
    const name = about.createDiv({
      cls: "psb-name",
      text: file.basename,
      attr: { role: "button", tabindex: "0", "aria-label": "Rename the board" },
    });
    const rename = () => this.inlineInput(name, file.basename, (v) => this.rename(v));
    name.addEventListener("click", rename);
    name.addEventListener("keydown", (evt) => evt.key === "Enter" && rename());

    const description = typeof props.description === "string" ? props.description : "";
    const desc = about.createDiv({
      cls: "psb-desc",
      text: description || "Add a description",
      attr: { role: "button", tabindex: "0", "aria-label": description ? "Edit the description" : "Add a description" },
    });
    desc.toggleClass("is-empty", !description);
    const edit = () => this.inlineInput(desc, description, (v) => void this.setDescription(v), true);
    desc.addEventListener("click", edit);
    desc.addEventListener("keydown", (evt) => evt.key === "Enter" && edit());

    const row = about.createDiv("psb-about-row");
    // The board's own tags: those in its properties, not the tags on its cards.
    const tags = row.createDiv("psb-tags");
    // Drawn as tags are on the cards below, and on note cards in the sidebar.
    for (const tag of parseFrontMatterTags(props) ?? []) badge(tags, null, tag, null, "ps-badge-tag");
    const add = tags.createEl("button", { cls: "psb-about-add", attr: { "aria-label": "Add a tag to the board" } });
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Tag" });
    add.addEventListener("click", () => host.addTag(file));

    const notes = host.embeddedIn(file);
    this.embeddedKey = embedKey(notes);
    if (!notes.length) {
      // Not in any note yet: offer to put it at the end of one.
      // Beside "Tag", in the same group, so the two sit and size alike.
      const embed = tags.createEl("button", { cls: "psb-about-add", attr: { "aria-label": "Embed the board at the end of a note" } });
      setIcon(embed.createSpan(), "file-symlink");
      embed.createSpan({ text: "Embed in note" });
      embed.addEventListener("click", () => host.embedIn(file));
    } else {
      const where = row.createDiv("psb-embedded");
      setIcon(where.createSpan("psb-embedded-icon"), "file-symlink");
      const names = where.createSpan({ text: "Embedded in " });
      notes.forEach((note, i) => {
        if (i) names.appendText(", ");
        const link = names.createEl("a", { cls: "internal-link", text: note.basename, href: note.path });
        link.addEventListener("click", (evt) => {
          evt.preventDefault();
          this.open(note, Keymap.isModEvent(evt));
        });
      });
    }
    row.createSpan({ cls: "psb-count", text: cards });
  }

  /** Rename the board's file, as the sidebar's Rename does; links to it follow. */
  private rename(name: string): void {
    const file = this.file!;
    const problem = folderNameError(name);
    if (problem) return void new Notice(problem);
    const parent = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
    const path = normalizePath(`${parent}${name}.${file.extension}`);
    if (path === file.path) return;
    if (this.app.vault.getAbstractFileByPath(path)) return void new Notice("Something with that name already exists here.");
    this.app.fileManager.renameFile(file, path).catch((err: Error) => new Notice(`Couldn't rename: ${err.message}`));
  }

  private async setDescription(value: string): Promise<void> {
    let refused = false;
    await this.app.vault.process(this.file!, (text) => {
      const next = setTextProperty(text, "description", value);
      refused = next === null;
      return next ?? text;
    });
    if (refused) {
      new Notice("This board's description is written over several lines, so it wasn't changed. Edit it with Open as Markdown.", 8000);
    }
  }

  private renderLane(parent: HTMLElement, board: Board, i: number): void {
    const lane = board.lanes[i];
    const ref: LaneRef = { lane: i, raw: this.lines[lane.line] };
    const el = parent.createDiv({ cls: "psb-lane" });
    el.toggleClass("is-collapsed", lane.collapsed);
    if (lane.colour && this.coloured) el.dataset.colour = lane.colour;

    const head = el.createDiv({ cls: "psb-lane-head", attr: { draggable: "true" } });
    head.addEventListener("dragstart", (evt) => this.startDrag(evt, el, { kind: "lane", ref }));
    head.addEventListener("dragend", () => this.endDrag());
    setIcon(head.createSpan({ cls: "psb-grip", attr: { "aria-label": "Drag to move the list" } }), "grip-vertical");
    const name = head.createDiv({ cls: "psb-lane-title", text: lane.title });
    // A minimized list is a narrow strip with no room for its menu or for
    // typing a name: a click on it opens it again.
    if (lane.collapsed) {
      head.setAttrs({ role: "button", tabindex: "0", "aria-label": `Open the list ${lane.title}` });
      const open = () => this.write((t) => setLaneCollapsed(t, ref, false));
      head.addEventListener("click", open);
      head.addEventListener("keydown", (evt) => evt.key === "Enter" && void open());
    } else {
      name.addEventListener("click", () => this.inlineInput(name, lane.title, (v) => this.write((t) => renameLane(t, ref, v))));
    }
    const status = STATUSES.find(([char]) => char === lane.status);
    if (status) {
      setIcon(head.createSpan({ cls: "psb-lane-status", attr: { "aria-label": `Cards here are marked ${status[1].toLowerCase()}` } }), status[2]);
    }
    head.createSpan({ cls: "psb-lane-count", text: lane.limit ? `${lane.cards.length}/${lane.limit}` : String(lane.cards.length) });
    const more = head.createEl("button", { cls: "psb-icon clickable-icon", attr: { "aria-label": "List actions" } });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (evt) => this.laneMenu(evt, board, ref, name));

    const cardsEl = el.createDiv("psb-cards");
    lane.cards.forEach((_, c) => this.renderCard(cardsEl, board, i, c));
    // The whole list takes a dropped card, so an empty list is easy to hit.
    this.dropZone(
      el,
      cardsEl,
      ".psb-card",
      "card",
      "y",
      `Move to “${lane.title}”`,
      (index) => {
        const drag = this.drag;
        if (drag?.kind === "card") void this.write((t) => moveCard(t, drag.ref, ref, index, this.viaTasks));
      },
      // A task dragged in from the Tasks list becomes a card here.
      (index) => this.takeTask(ref, index)
    );

    const add = el.createEl("button", { cls: "psb-add", text: "Add a card" });
    add.addEventListener("click", () => this.addCardInput(el, add, ref));
  }

  private renderCard(parent: HTMLElement, board: Board, lane: number, index: number): void {
    const card = board.lanes[lane].cards[index];
    const ref: CardRef = { lane, card: index, raw: this.lines[card.line] };
    const done = isDone(card.check);
    const el = parent.createDiv({ cls: "psb-card", attr: { draggable: "true", "data-status": card.check ?? " " } });
    el.toggleClass("is-done", done || card.check === "-");
    el.addEventListener("dragstart", (evt) => this.startDrag(evt, el, { kind: "card", ref }));
    el.addEventListener("dragend", () => this.endDrag());

    const box = el.createEl("button", {
      cls: "psb-check",
      attr: { "aria-label": done ? "Mark as not done" : "Mark as done", role: "checkbox", "aria-checked": String(done) },
    });
    if (done) setIcon(box, "check");
    else if (card.check === "-") setIcon(box, "minus");
    box.addEventListener("click", () => this.write((t) => toggleCard(t, ref, this.viaTasks)));

    // The card's text, with what reads better as badges taken out: Kanban's
    // date and time, and the first line's Tasks-plugin details and end tags.
    const { body, date, time } = cardDisplay(card.text);
    const [first, ...rest] = body.split("\n");
    const details = taskDetails(first);
    const content = el.createDiv("psb-card-body");
    const textEl = content.createDiv("psb-card-text");
    void MarkdownRenderer.render(this.app, [details.description, ...rest].join("\n"), textEl, this.file!.path, this.cards);
    textEl.addEventListener("click", (evt) => {
      const link = (evt.target as HTMLElement).closest("a");
      if (link) return this.followLink(evt, link);
      this.editCardInput(content, card.text, ref);
    });

    const more = el.createEl("button", { cls: "psb-icon clickable-icon", attr: { "aria-label": "Card actions" } });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (evt) => this.cardMenu(evt, board, ref, () => this.editCardInput(content, card.text, ref)));

    // A footer across the card, under the text and the menu button.
    const foot = el.createDiv("psb-card-foot");
    if (date) badge(foot, "calendar", date, `Date ${date}`);
    if (time) badge(foot, "clock", time, `Time ${time}`);
    taskBadges(foot, details, done || card.check === "-", localISODate());
    if (!foot.childElementCount) foot.remove();
  }

  /** After the last list, on the board's own page: a small outlined +. */
  private renderAddLane(parent: HTMLElement): void {
    const add = parent.createEl("button", { cls: "psb-lane-new", attr: { "aria-label": "Add a list" } });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.addList());
  }

  /** Add a list at the end, with its name open for typing over. */
  addList(): void {
    this.nameNewList = true;
    void this.write((t) => addLane(t, "New list"));
  }

  // ---- Editing in place -------------------------------------------------

  /** Swap `el`'s text for a one-line input; Enter or leaving it saves. */
  private inlineInput(el: HTMLElement, value: string, save: (v: string) => void, allowEmpty = false): void {
    el.hide();
    const input = createEl("input", { cls: "psb-input", attr: { type: "text" } });
    input.value = value;
    el.after(input);
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      el.show();
      if (keep && (v || allowEmpty) && v !== value) save(v);
      this.doneTyping();
    };
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.isComposing) finish(true);
      if (evt.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  }

  /**
   * An editor for card text: Enter saves, Shift+Enter adds a line, Escape
   * cancels. Obsidian's own editor where it can be had (so the Tasks
   * plugin's suggestions and link completion work), a text box otherwise.
   */
  private cardInput(parent: HTMLElement, value: string, onEnter: (v: string) => void, onClose: (v: string | null) => void): CardEditor {
    const editor = openCardEditor(this.app, parent, this.file!, value, { enter: onEnter, close: onClose });
    if (editor) return editor;
    const area = parent.createEl("textarea", { cls: "psb-input psb-textarea" });
    area.value = value;
    const fit = () => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight}px`;
    };
    area.addEventListener("input", fit);
    area.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        onClose(null);
      } else if (evt.key === "Enter" && !evt.shiftKey && !evt.isComposing) {
        evt.preventDefault();
        onEnter(area.value);
      }
    });
    area.addEventListener("blur", () => onClose(area.value));
    area.focus();
    area.setSelectionRange(value.length, value.length);
    requestAnimationFrame(fit);
    return area;
  }

  private editCardInput(content: HTMLElement, text: string, ref: CardRef): void {
    if (content.querySelector(".psb-input")) return;
    for (const child of Array.from(content.children)) (child as HTMLElement).hide();
    let closed = false;
    const close = (value: string | null) => {
      if (closed) return;
      closed = true;
      area.remove();
      for (const child of Array.from(content.children)) (child as HTMLElement).show();
      if (value !== null && value.trim() && value.trim() !== text.trim()) void this.write((t) => editCard(t, ref, value));
      this.doneTyping();
    };
    const area = this.cardInput(content, text, (v) => close(v), close);
  }

  /** Stays open after Enter, so several cards can be added in a row. */
  private addCardInput(laneEl: HTMLElement, button: HTMLElement, ref: LaneRef): void {
    button.hide();
    let closed = false;
    const close = (value: string | null) => {
      if (closed) return;
      closed = true;
      area.remove();
      button.show();
      if (value?.trim()) void this.write((t) => addCard(t, ref, value));
      this.doneTyping();
    };
    const area = this.cardInput(
      laneEl,
      "",
      (v) => {
        if (!v.trim()) return;
        // The new card shows on the redraw, which then opens a fresh box.
        this.reopenAdd = ref.lane;
        close(v);
      },
      close
    );
  }

  // ---- Menus ------------------------------------------------------------

  private cardMenu(evt: MouseEvent, board: Board, ref: CardRef, edit: () => void): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Edit").setIcon("pencil").onClick(edit));
    const current = (board.lanes[ref.lane].cards[ref.card].check ?? " ").toLowerCase();
    for (const [char, label, icon] of STATUSES) {
      if (char === current) continue;
      menu.addItem((i) =>
        i
          .setTitle(`Mark as ${label.toLowerCase()}`)
          .setIcon(icon)
          .onClick(() => this.write((t) => setCardStatus(t, ref, char, this.viaTasks)))
      );
    }
    menu.addSeparator();
    board.lanes.forEach((lane, l) => {
      if (l === ref.lane) return;
      const to: LaneRef = { lane: l, raw: this.lines[lane.line] };
      menu.addItem((i) =>
        i
          .setTitle(`Move to ${lane.title}`)
          .setIcon("arrow-right")
          .onClick(() => this.write((t) => moveCard(t, ref, to, lane.cards.length, this.viaTasks)))
      );
    });
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete card")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => this.write((t) => deleteCard(t, ref)))
    );
    menu.showAtMouseEvent(evt);
  }

  private laneMenu(evt: MouseEvent, board: Board, ref: LaneRef, name: HTMLElement): void {
    const lane = board.lanes[ref.lane];
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Rename")
        .setIcon("pencil")
        .onClick(() => this.inlineInput(name, lane.title, (v) => this.write((t) => renameLane(t, ref, v))))
    );
    menu.addItem((i) =>
      i
        .setTitle("Minimize")
        .setIcon("minimize-2")
        .onClick(() => this.write((t) => setLaneCollapsed(t, ref, true)))
    );
    if (ref.lane > 0) {
      menu.addItem((i) =>
        i
          .setTitle("Move left")
          .setIcon("arrow-left")
          .onClick(() => this.write((t) => moveLane(t, ref, ref.lane - 1)))
      );
    }
    if (ref.lane < board.lanes.length - 1) {
      menu.addItem((i) =>
        i
          .setTitle("Move right")
          .setIcon("arrow-right")
          .onClick(() => this.write((t) => moveLane(t, ref, ref.lane + 2)))
      );
    }
    // The list's colour, in a submenu where Obsidian has them (it does, though
    // not in its typings); listed in this menu otherwise.
    const colours = (to: Menu) => {
      for (const colour of [null, ...LIST_COLOURS]) {
        to.addItem((i) =>
          i
            .setTitle(colour ? colour[0].toUpperCase() + colour.slice(1) : "No colour")
            .setChecked(lane.colour === colour)
            .onClick(() => this.write((t) => setLaneColour(t, ref, colour)))
        );
      }
    };
    let listed = false;
    if (this.coloured) {
      menu.addItem((i) => {
        i.setTitle("Colour").setIcon("palette");
        const sub = (i as unknown as { setSubmenu?(): Menu }).setSubmenu?.();
        if (sub) colours(sub);
        else listed = true;
      });
    }
    if (listed) colours(menu);
    // The status cards take when they land here; Kanban knows only "done".
    menu.addSeparator();
    for (const [char, label, icon] of [[null, "no status", "circle"], ...STATUSES.slice(1)] as const) {
      menu.addItem((i) =>
        i
          .setTitle(char === null ? "Cards here keep their status" : `Cards here are ${label.toLowerCase()}`)
          .setIcon(icon)
          .setChecked(lane.status === char)
          .onClick(() => this.write((t) => setLaneStatus(t, ref, char)))
      );
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete list")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => {
          const n = lane.cards.length;
          const remove = () => this.write((t) => deleteLane(t, ref));
          if (!n) return void remove();
          new ConfirmModal(this.app, `Delete “${lane.title}” and its ${n} card${n === 1 ? "" : "s"}?`, remove).open();
        })
    );
    menu.showAtMouseEvent(evt);
  }

  private followLink(evt: MouseEvent, link: HTMLAnchorElement): void {
    if (!link.hasClass("internal-link")) return; // external links open on their own
    evt.preventDefault();
    const target = link.getAttribute("data-href") ?? link.getAttribute("href") ?? "";
    void this.app.workspace.openLinkText(target, this.file!.path, Keymap.isModEvent(evt));
  }

  // ---- Drag and drop ----------------------------------------------------

  private startDrag(evt: DragEvent, el: HTMLElement, drag: Drag): void {
    evt.stopPropagation(); // a card inside a list isn't the list
    this.drag = drag;
    // Something that isn't text, so a drop in a note types nothing.
    evt.dataTransfer?.setData("application/x-plainsight-board", "1");
    const { width, height } = el.getBoundingClientRect();
    // A copy hangs from the pointer, as in the sidebar. Without Obsidian's
    // drag manager the drag still works, with the browser's own picture.
    dragCopy(evt, el, (ghost) => {
      ghost.el.addClass("psb-board");
      return startBoardDrag(this.app, evt, ghost) || true;
    });
    if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
    // The slot: an empty space the size of what's dragged, shown where it would land.
    this.slot = createDiv("psb-drop");
    this.slot.style.width = `${width}px`;
    this.slot.style.height = `${height}px`;
    const slot = this.slot;
    // After the browser has taken its picture of the element: the slot takes its place.
    requestAnimationFrame(() => {
      if (this.slot !== slot) return;
      el.before(slot);
      el.addClass("is-dragging");
    });
  }

  /** A task dragged in from the Tasks list lands in a list as a card, and leaves its note. */
  private takeTask(to: LaneRef, index: number): void {
    const task = draggedTask();
    if (!task || !this.file) return;
    if (task.path === this.file.path) return void new Notice("That card is already on this board. Drag the card itself to move it.");
    void moveTaskOut(this.app, task, async (block) => {
      const { check, body } = taskAsCard(block);
      if (!(await this.write((t) => insertCard(t, to, index, body, check, this.viaTasks)))) throw new Error("the board changed");
    });
  }

  private endDrag(): void {
    this.drag = null;
    this.slot?.remove();
    this.slot = null;
    this.containerEl.querySelectorAll(".is-dragging").forEach((e) => e.removeClass("is-dragging"));
  }

  /**
   * Let a drag of `kind` over `target` place the slot among `zone`'s
   * `items`, and a drop there report the position: an index among the
   * items as they were before the drag.
   */
  private dropZone(
    target: HTMLElement,
    zone: HTMLElement,
    items: string,
    kind: Drag["kind"],
    axis: "x" | "y",
    /** What a drop here would do, said beside the pointer. */
    hint: string,
    drop: (index: number) => void,
    /** Also take a task dragged in from outside the board: what to do with it. */
    task?: (index: number) => void
  ): void {
    const place = (evt: DragEvent) => {
      const all = Array.from(zone.querySelectorAll<HTMLElement>(`:scope > ${items}:not(.psb-lane-new)`));
      const shown = all.filter((e) => !e.hasClass("is-dragging"));
      const before = shown.filter((e) => {
        const r = e.getBoundingClientRect();
        return axis === "y" ? evt.clientY > r.top + r.height / 2 : evt.clientX > r.left + r.width / 2;
      }).length;
      // The dragged item is hidden; count it if it sat before this spot.
      const from = all.findIndex((e) => e.hasClass("is-dragging"));
      return { next: shown[before] ?? zone.querySelector<HTMLElement>(":scope > .psb-lane-new"), index: from >= 0 && from <= before ? before + 1 : before };
    };
    // Nothing of the board's own is being dragged, and a task is on its way in.
    const incoming = () => !!task && !this.drag && !!draggedTask();
    target.addEventListener("dragover", (evt) => {
      if (incoming()) {
        // The slot it would take: the height of a one-line card.
        if (!this.slot) {
          this.slot = createDiv("psb-drop");
          this.slot.style.height = "36px";
        }
      } else if (this.drag?.kind !== kind || !this.slot) {
        return;
      }
      dragAction(this.app, hint);
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      evt.preventDefault();
      // Not stopped: Obsidian's drag manager, further up, moves the copy that follows the pointer.
      const { next } = place(evt);
      if (this.slot!.parentElement !== zone || this.slot!.nextElementSibling !== next) zone.insertBefore(this.slot!, next);
    });
    target.addEventListener("drop", (evt) => {
      const taking = incoming();
      if (!taking && this.drag?.kind !== kind) return;
      evt.preventDefault();
      evt.stopPropagation();
      (taking ? task! : drop)(place(evt).index);
      this.endDrag();
    });
  }
}

/** Which notes, as one value to compare. */
const embedKey = (notes: TFile[]) => notes.map((n) => n.path).join("\n");

/** The properties at the top of a note's text; none if they can't be read. */
function properties(text: string): Record<string, unknown> {
  try {
    const info = getFrontMatterInfo(text);
    const data = info.exists ? (parseYaml(info.frontmatter) as unknown) : null;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

class ConfirmModal extends Modal {
  constructor(app: App, private question: string, private onYes: () => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.question });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onYes();
          })
      );
  }
}
