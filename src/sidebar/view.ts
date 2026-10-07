import { ItemView, Keymap, Menu, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type WysiwygPlugin from "../main";
import { cardDate, localISODate } from "./core/format";
import {
  folderRows,
  groupNotes,
  notesFor,
  Place,
  QueryOptions,
  SortKey,
  tagRows,
  TaskFilter,
  taskProgress,
  taskRows,
  TreeRow,
} from "./core/queries";
import { taskDisplayText } from "./core/tasks";
import { isClosed, NoteSummary } from "./core/types";
import { createNote, openFile, toggleTask, togglePin } from "./actions";
import { openGlobalSearch, openSettingsTab, readShortcuts, templateOptions } from "./internals";

export const SIDEBAR_VIEW = "plainsight-sidebar";
/** Cards rendered per scroll step; the rest load as the end comes into view. */
const BATCH = 100;

type ListItem = { label: string } | { note: NoteSummary };

/** Two columns: places on the left, the selected place's notes or tasks on the right. */
export class SidebarView extends ItemView {
  private place: Place = { kind: "notes" };
  private sort: SortKey = "modified";
  private search = "";
  private taskFilter: TaskFilter = "open";
  /** Mobile shows one column at a time. */
  private mobilePane: "nav" | "list" = "nav";

  private navEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private filtersEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private observers: IntersectionObserver[] = [];
  private renderTimer: number | null = null;
  /** Items rendered so far; re-renders restore at least this many so the
   * saved scroll position still has content to land on. */
  private renderedCount = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WysiwygPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return "Notes";
  }

  getIcon(): string {
    return "notebook";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ps-sidebar");
    root.toggleClass("is-mobile", Platform.isMobile);
    root.style.setProperty("--ps-nav-width", `${this.plugin.settings.sidebarNavWidth}px`);

    this.navEl = root.createDiv("ps-nav");
    const divider = root.createDiv("ps-divider");
    const list = root.createDiv("ps-list");
    this.headerEl = list.createDiv("ps-list-header");
    // Built once: re-creating the input on every render would steal focus mid-typing.
    const search = list.createEl("input", {
      cls: "ps-search",
      type: "search",
      placeholder: "Search",
    });
    search.addEventListener("input", () => {
      this.search = search.value;
      this.resetScroll();
      this.renderList();
    });
    this.filtersEl = list.createDiv("ps-filters");
    this.bodyEl = list.createDiv("ps-list-body");

    this.makeResizable(divider);
    this.unsubscribe = this.plugin.index.subscribe(() => this.queueRender());
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.disconnectObservers();
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  /** Index changes arrive in bursts (startup, folder renames); coalesce them. */
  private queueRender(): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 150);
  }

  private render(): void {
    // A renamed or deleted notebook would otherwise leave an empty list whose
    // "New note" targets a folder that no longer exists.
    if (this.place.kind === "notebook" && !this.plugin.indexer.folders().includes(this.place.folder)) {
      this.place = { kind: "notes" };
      this.resetScroll();
    }
    this.contentEl.toggleClass("show-list", this.mobilePane === "list");
    this.renderNav();
    this.renderList();
  }

  private setPlace(place: Place): void {
    this.place = place;
    this.mobilePane = "list";
    this.resetScroll();
    this.render();
  }

  /** A new place, sort, filter or search starts at the top again. */
  private resetScroll(): void {
    this.renderedCount = 0;
    this.bodyEl.scrollTop = 0;
  }

  private isActive(place: Place): boolean {
    return JSON.stringify(place) === JSON.stringify(this.place);
  }

  private queryOptions(search = this.search): QueryOptions {
    return { sort: this.sort, search, templatesFolder: templateOptions(this.app).folder };
  }

  private currentFolder(): string | null {
    return this.place.kind === "notebook" ? this.place.folder : null;
  }

  // ---------- nav column ----------

  private renderNav(): void {
    const nav = this.navEl;
    nav.empty();
    const notes = this.plugin.index.all();
    const templates = templateOptions(this.app).folder;
    const unfiltered = this.queryOptions("");

    const newNote = nav.createDiv("ps-new-note");
    setIcon(newNote.createSpan("ps-nav-icon"), "file-plus-2");
    newNote.createSpan({ text: "Note" });
    newNote.addEventListener("click", () => void createNote(this.app, this.currentFolder()));

    const shortcuts = readShortcuts(this.app);
    if (shortcuts && shortcuts.length) {
      this.navHeading(nav, "Shortcuts", "star");
      for (const s of shortcuts) {
        const icon = s.kind === "folder" ? "folder" : s.kind === "search" ? "search" : "file-text";
        const row = this.navRow(nav, s.title, icon, 1, null, false);
        row.addEventListener("click", (evt) => this.openShortcut(s.kind, s.target, evt));
      }
    }

    const noteCount = notesFor(notes, { kind: "notes" }, unfiltered).length;
    const openTasks = taskRows(notes, "open", localISODate(), templates).length;
    const templateCount = templates
      ? notesFor(notes, { kind: "templates" }, unfiltered).length
      : null;
    this.placeRow(nav, "Notes", "file-text", { kind: "notes" }, 0, noteCount);
    this.placeRow(nav, "Tasks", "check-circle-2", { kind: "tasks" }, 0, openTasks);
    this.placeRow(nav, "Templates", "layout-template", { kind: "templates" }, 0, templateCount);

    const notebooks = folderRows(this.plugin.indexer.folders(), notes, templates);
    if (notebooks.length) {
      this.navHeading(nav, "Notebooks", "book");
      this.treeSection(nav, notebooks, (row) => ({ kind: "notebook", folder: row.path }));
    }

    const tags = tagRows(notes);
    if (tags.length) {
      this.navHeading(nav, "Tags", "tag");
      this.treeSection(nav, tags, (row) => ({ kind: "tag", tag: row.path }));
    }
  }

  private navHeading(parent: HTMLElement, label: string, icon: string): void {
    const el = parent.createDiv("ps-nav-heading");
    setIcon(el.createSpan("ps-nav-icon"), icon);
    el.createSpan({ text: label });
  }

  private navRow(
    parent: HTMLElement,
    label: string,
    icon: string | null,
    depth: number,
    count: number | null,
    active: boolean
  ): HTMLElement {
    const row = parent.createDiv("ps-nav-item");
    row.style.setProperty("--ps-depth", String(depth));
    row.toggleClass("is-active", active);
    const iconEl = row.createSpan("ps-nav-icon");
    if (icon) setIcon(iconEl, icon);
    row.createSpan({ cls: "ps-nav-label", text: label });
    if (count !== null) row.createSpan({ cls: "ps-nav-count", text: String(count) });
    return row;
  }

  private placeRow(
    parent: HTMLElement,
    label: string,
    icon: string | null,
    place: Place,
    depth: number,
    count: number | null
  ): void {
    const row = this.navRow(parent, label, icon, depth, count, this.isActive(place));
    row.addEventListener("click", () => this.setPlace(place));
  }

  private treeSection(parent: HTMLElement, rows: TreeRow[], toPlace: (row: TreeRow) => Place): void {
    // Tree rows are indented without icons.
    for (const row of rows) {
      this.placeRow(parent, row.name, null, toPlace(row), row.depth + 1, row.count);
    }
  }

  private openShortcut(kind: "file" | "folder" | "search", target: string, evt: MouseEvent): void {
    if (kind === "folder") {
      this.setPlace({ kind: "notebook", folder: target });
    } else if (kind === "search") {
      openGlobalSearch(this.app, target);
    } else {
      const file = this.app.vault.getAbstractFileByPath(target);
      if (file instanceof TFile) void openFile(this.app, file, Keymap.isModEvent(evt));
    }
  }

  // ---------- divider ----------

  private makeResizable(divider: HTMLElement): void {
    divider.addEventListener("mousedown", (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startWidth = this.navEl.getBoundingClientRect().width;
      const move = (evt: MouseEvent) => {
        const width = Math.min(360, Math.max(140, startWidth + evt.clientX - startX));
        this.contentEl.style.setProperty("--ps-nav-width", `${width}px`);
        this.plugin.settings.sidebarNavWidth = Math.round(width);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        // saveData, not saveSettings: the latter reconfigures every editor and
        // re-applies the rendering mode — pointless work for a divider drag.
        void this.plugin.saveData(this.plugin.settings);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  // ---------- list column ----------

  private renderList(): void {
    this.disconnectObservers();
    const scroll = this.bodyEl.scrollTop;
    this.headerEl.empty();
    this.filtersEl.empty();
    this.bodyEl.empty();

    if (Platform.isMobile) {
      const back = this.headerEl.createDiv("ps-back");
      setIcon(back, "chevron-left");
      back.addEventListener("click", () => {
        this.mobilePane = "nav";
        this.render();
      });
    }

    if (this.place.kind === "tasks") {
      this.renderTasks();
    } else if (this.place.kind === "templates" && !templateOptions(this.app).folder) {
      this.renderHeader("Templates", null);
      const empty = this.bodyEl.createDiv("ps-empty");
      empty.createDiv({ text: "No templates folder is set." });
      const button = empty.createEl("button", { text: "Choose folder" });
      button.addEventListener("click", () => openSettingsTab(this.app, "templates"));
    } else {
      this.renderNotes();
    }
    this.bodyEl.scrollTop = scroll;
  }

  private renderNotes(): void {
    const list = notesFor(this.plugin.index.all(), this.place, this.queryOptions());
    this.renderHeader(this.placeTitle(), list.length);
    if (!list.length) {
      this.bodyEl.createDiv({ cls: "ps-empty", text: this.search ? "No matches" : "No notes" });
      return;
    }
    const items: ListItem[] = [];
    for (const group of groupNotes(list, this.sort)) {
      if (group.label) items.push({ label: group.label });
      for (const note of group.notes) items.push({ note });
    }
    this.renderIncrementally(items.length, (i) => {
      const item = items[i];
      if ("label" in item) this.bodyEl.createDiv({ cls: "ps-group-label", text: item.label });
      else this.renderCard(item.note);
    });
  }

  /** Render `count` items in batches as the user scrolls, not all at once. */
  private renderIncrementally(count: number, renderAt: (i: number) => void): void {
    let next = 0;
    let size = Math.max(BATCH, this.renderedCount);
    const step = () => {
      const end = Math.min(next + size, count);
      for (; next < end; next++) renderAt(next);
      this.renderedCount = next;
      size = BATCH;
      if (next >= count) return;
      const sentinel = this.bodyEl.createDiv("ps-sentinel");
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer.disconnect();
          sentinel.remove();
          step();
        },
        { root: this.bodyEl }
      );
      observer.observe(sentinel);
      this.observers.push(observer);
    };
    step();
  }

  private disconnectObservers(): void {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
  }

  private renderHeader(title: string, count: number | null): void {
    const row = this.headerEl.createDiv("ps-header-row");
    row.createSpan({ cls: "ps-title", text: title });
    if (count !== null) row.createSpan({ cls: "ps-count", text: String(count) });
    const actions = row.createDiv("ps-actions");

    const add = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "New note" } });
    setIcon(add, "file-plus-2");
    add.addEventListener("click", () => void createNote(this.app, this.currentFolder()));

    if (this.place.kind === "tasks") return;
    const sort = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "Sort" } });
    setIcon(sort, "arrow-up-down");
    sort.addEventListener("click", (evt) => {
      const menu = new Menu();
      const options: Array<[SortKey, string]> = [
        ["modified", "Date updated"],
        ["created", "Date created"],
        ["title", "Title"],
      ];
      for (const [key, label] of options) {
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setChecked(this.sort === key)
            .onClick(() => {
              this.sort = key;
              this.resetScroll();
              this.renderList();
            })
        );
      }
      menu.showAtMouseEvent(evt);
    });
  }

  private placeTitle(): string {
    switch (this.place.kind) {
      case "notes":
        return "Notes";
      case "tasks":
        return "Tasks";
      case "templates":
        return "Templates";
      case "notebook":
        return this.place.folder.split("/").pop()!;
      case "tag":
        return `#${this.place.tag}`;
    }
  }

  private renderCard(note: NoteSummary): void {
    const card = this.bodyEl.createDiv({ cls: "ps-card", attr: { "data-path": note.path } });
    card.toggleClass("is-active", this.app.workspace.getActiveFile()?.path === note.path);
    const text = card.createDiv("ps-card-text");

    const title = text.createDiv("ps-card-title");
    title.createSpan({ text: note.title });
    if (note.pinned) setIcon(title.createSpan("ps-card-pin"), "pin");
    if (note.snippet) text.createDiv({ cls: "ps-card-snippet", text: note.snippet });

    const { closed, total } = taskProgress(note);
    if (total) {
      const chip = text.createDiv("ps-card-tasks");
      setIcon(chip.createSpan(), "check-circle-2");
      chip.createSpan({ text: `${closed}/${total}` });
    }

    const meta = text.createDiv("ps-card-meta");
    const time = this.sort === "created" ? note.ctime : note.mtime;
    meta.createSpan({ cls: "ps-card-date", text: cardDate(time) });
    for (const tag of note.tags.slice(0, 3)) meta.createSpan({ cls: "ps-card-tag", text: tag });

    const src = this.imageSrc(note);
    if (src) {
      card.createDiv("ps-card-thumb").createEl("img", { attr: { src, loading: "lazy", alt: "" } });
    }

    card.addEventListener("click", (evt) => {
      const file = this.app.vault.getAbstractFileByPath(note.path);
      if (!(file instanceof TFile)) return;
      if (this.place.kind === "templates") void createNote(this.app, null, file);
      else void openFile(this.app, file, Keymap.isModEvent(evt));
    });
    card.addEventListener("contextmenu", (evt) => this.cardMenu(evt, note));
  }

  private cardMenu(evt: MouseEvent, note: NoteSummary): void {
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) return;
    evt.preventDefault();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(note.pinned ? "Unpin note" : "Pin note")
        .setIcon(note.pinned ? "pin-off" : "pin")
        .onClick(() => void togglePin(this.app, file))
    );
    if (this.place.kind === "templates") {
      menu.addItem((item) =>
        item
          .setTitle("Edit template")
          .setIcon("pencil")
          .onClick(() => void openFile(this.app, file, false))
      );
    }
    menu.addSeparator();
    // Obsidian's own file menu: rename, move to folder (= change notebook),
    // delete, and other plugins' items.
    this.app.workspace.trigger("file-menu", menu, file, "plainsight-sidebar");
    menu.showAtMouseEvent(evt);
  }

  private imageSrc(note: NoteSummary): string | null {
    const target = note.thumbnail;
    if (!target) return null;
    if (/^https?:\/\//i.test(target)) return target;
    const file = this.app.metadataCache.getFirstLinkpathDest(target, note.path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  /** Cheap highlight update when a note is opened elsewhere. */
  private markActive(): void {
    const active = this.app.workspace.getActiveFile()?.path;
    this.bodyEl.querySelectorAll<HTMLElement>(".ps-card").forEach((el) => {
      el.toggleClass("is-active", el.dataset.path === active);
    });
  }

  // ---------- task rows ----------

  private renderTasks(): void {
    const today = localISODate();
    const rows = taskRows(
      this.plugin.index.all(),
      this.taskFilter,
      today,
      templateOptions(this.app).folder
    );
    this.renderHeader("Tasks", rows.length);

    const filters: Array<[TaskFilter, string]> = [
      ["open", "Open"],
      ["overdue", "Overdue"],
      ["done", "Done"],
    ];
    for (const [key, label] of filters) {
      const tab = this.filtersEl.createDiv({ cls: "ps-filter", text: label });
      tab.toggleClass("is-active", this.taskFilter === key);
      tab.addEventListener("click", () => {
        this.taskFilter = key;
        this.resetScroll();
        this.renderList();
      });
    }

    if (!rows.length) {
      this.bodyEl.createDiv({ cls: "ps-empty", text: "No tasks" });
      return;
    }
    this.renderIncrementally(rows.length, (i) => {
      const { note, task } = rows[i];
      const row = this.bodyEl.createDiv("ps-task");
      const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      box.checked = isClosed(task);
      box.addEventListener("click", (evt) => evt.stopPropagation());
      box.addEventListener("change", async () => {
        // On success the index update re-renders the row. When nothing was
        // written (stale line, or Tasks declined), put the box back.
        const written = await toggleTask(this.app, note.path, task);
        if (!written) box.checked = isClosed(task);
      });

      const body = row.createDiv("ps-task-body");
      body.createDiv({ cls: "ps-task-text", text: taskDisplayText(task.text) || task.text });
      const meta = body.createDiv("ps-task-meta");
      meta.createSpan({ text: note.title });
      if (task.due) {
        const due = meta.createSpan({ cls: "ps-task-due", text: task.due });
        due.toggleClass("is-overdue", !isClosed(task) && task.due < today);
      }

      row.addEventListener("click", (evt) => {
        const file = this.app.vault.getAbstractFileByPath(note.path);
        if (file instanceof TFile) void openFile(this.app, file, Keymap.isModEvent(evt), task.line);
      });
    });
  }
}
