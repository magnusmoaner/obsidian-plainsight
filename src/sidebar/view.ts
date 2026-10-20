import {
  FileView,
  getLinkpath,
  HoverParent,
  HoverPopover,
  ItemView,
  Keymap,
  MarkdownView,
  Menu,
  Notice,
  PaneType,
  Platform,
  SearchComponent,
  setIcon,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import type WysiwygPlugin from "../main";
import { cardDate, dueDateLabel, localISODate } from "./core/format";
import {
  filterTaskRows,
  folderRows,
  groupNotes,
  groupNotesBy,
  kindCounts,
  NoteGrouping,
  groupTaskRows,
  TaskGrouping,
  TaskRow,
  notesOfTaskRows,
  notesFor,
  Place,
  QueryOptions,
  SortKey,
  tagRows,
  TaskFilter,
  taskProgress,
  taskRows,
  TreeRow,
  visibleRows,
  compareNames,
} from "./core/queries";
import {
  AttachmentFile,
  attachmentFolderMatcher,
  attachmentsFor,
  formatSize,
} from "./core/attachments";
import type { OcrBox } from "./core/ocr-boxes";
import { extractSnippet } from "./core/snippet";
import { taskDetails } from "./core/task-details";
import { PRIORITIES } from "./core/task-line";
import { taskTextColumn } from "./core/tasks";
import { holdsCards, inFolder, isClosed, NoteSummary, renamedPath } from "./core/types";
import { NAV_WIDTH } from "./core/view-state";
import { SearchModal, SearchSource } from "./search-modal";
import {
  addTagToNote,
  addTaskLine,
  createCanvas,
  createNote,
  createTaskListBoard,
  openFile,
  toggleTask,
  togglePin,
} from "./actions";
import {
  canHoldTasks,
  NotebookModal,
  RenameModal,
  NotePickerModal,
  PickerModal,
  TagModal,
  QuickTaskModal,
} from "./modals";
import {
  attachmentFolderSetting,
  Bookmark,
  bookmarksInstance,
  onBookmarksChanged,
  openGlobalSearch,
  openSettingsTab,
  hasCommand,
  placePopover,
  hasTasksPlugin,
  KANBAN_NEW_BOARD,
  newKanbanBoard,
  readBookmarks,
  removeBookmark,
  runCommand,
  TASK_LIST_KANBAN_NEW_BOARD,
  tasksLineOptions,
  tasksCreateModal,
  templateOptions,
} from "./internals";

export const SIDEBAR_VIEW = "plainsight-sidebar";

// Commands the More menu runs, as registered by Obsidian or the plugins.
// Items whose command isn't registered (plugin off or missing) are hidden.
const IMPORTER = "obsidian-importer:open-modal";
const INSERT_TEMPLATE = "templates:insert-template";
const NAV_COMMANDS: Array<[string, string, string]> = [
  ["switcher:open", "Quick switcher", "file-search"],
  ["graph:open", "Open graph view", "git-fork"],
];
/** Containing notes listed in an attachment's menu before "…and N more". */
const MAX_CONTAINING = 5;
/** Cards rendered per scroll step; the rest load as the end comes into view. */
const BATCH = 100;

type ListItem = { label: string } | { note: NoteSummary } | { file: AttachmentFile };

/** Not attachments: notes, canvases and bases are documents in their own right. */
const DOCUMENT_EXTENSIONS = new Set(["md", "canvas", "base"]);

/** The index split into the user's notes and attachment companions. */
interface Partitioned {
  notes: NoteSummary[];
  /** Attachment file path → the extracted-text notes made from it. */
  companions: Map<string, NoteSummary[]>;
  /** Attachment file path → OCR Extractor boxes holding its text, and the notes they're in. */
  boxes: Map<string, Array<{ note: NoteSummary; box: OcrBox }>>;
  isAttachmentFolder: (folder: string) => boolean;
}

/** Two columns: places on the left, the selected place's notes or tasks on the right. */
export class SidebarView extends ItemView implements HoverParent {
  private popover: HoverPopover | null = null;
  private place: Place = { kind: "notes" };
  private sort: SortKey = "modified";
  private search = "";
  /** Tasks page: only this note's tasks, or all notes when null. */
  private taskNoteFilter: string | null = null;
  /** Mobile shows one column at a time. */
  private mobilePane: "nav" | "list" = "nav";

  private navEl!: HTMLElement;
  private filterInput!: SearchComponent;
  private headerEl!: HTMLElement;
  private filtersEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private observers: IntersectionObserver[] = [];
  private renderTimer: number | null = null;
  /** Items rendered so far; re-renders restore at least this many so the
   * saved scroll position still has content to land on. */
  private renderedCount = 0;
  /** Renders the list's next batch, while there is one (renderIncrementally). */
  private renderNext: (() => boolean) | null = null;
  /** Rendered task rows by "path\0line", for O(1) highlight changes. */
  private taskRowEls = new Map<string, HTMLElement>();
  private activeTaskEl: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Whether the list has been drawn since the running fill began. */
  private drawnWhileLoading = false;
  /** A mouse button or finger is down inside the sidebar. */
  private pointerHeld = false;
  /** A render came due while the pointer was held; run it on release. */
  private renderWaiting = false;
  private unsubscribeBookmarks: (() => void) | null = null;
  private watchedBookmarks: unknown = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WysiwygPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_VIEW;
  }

  /**
   * The open Page Preview popover, set and cleared by Obsidian. A render
   * would replace the card it belongs to and close it under the mouse, so
   * renders wait (see queueRender) until it closes.
   */
  get hoverPopover(): HoverPopover | null {
    return this.popover;
  }

  set hoverPopover(popover: HoverPopover | null) {
    this.popover = popover;
    if (popover) {
      placePopover(popover, (hoverEl, target) => this.placeBeside(hoverEl, target));
      return;
    }
    this.markActive();
    if (this.renderWaiting) {
      this.renderWaiting = false;
      this.queueRender();
    }
  }

  getDisplayText(): string {
    return "Notes";
  }

  getIcon(): string {
    return "notebook";
  }

  /**
   * The sidebar is see-through, so it shows what the theme paints behind it,
   * as the ribbon and title bar do (Velocity: a gradient on the body). Its
   * sticky action row must be opaque, so give it a copy of that painting:
   * the first background colour behind the sidebar, plus any image (such as
   * a gradient) found on the way there.
   */
  private matchSurface(): void {
    let color = "";
    let image = "";
    for (let el = this.contentEl.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (!image && style.backgroundImage !== "none") image = style.backgroundImage;
      const bg = style.backgroundColor;
      if (bg && bg !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(bg)) {
        color = bg;
        break;
      }
    }
    const root = this.contentEl.style;
    if (color) root.setProperty("--ps-surface-color", color);
    else root.removeProperty("--ps-surface-color");
    if (image) root.setProperty("--ps-surface-image", image);
    else root.removeProperty("--ps-surface-image");
  }

  /** The list panel's gaps and rounded corners, from the settings. */
  applyListInset(): void {
    const s = this.plugin.settings;
    this.contentEl.toggleClass("ps-inset-top", s.listInsetTop);
    this.contentEl.toggleClass("ps-inset-bottom", s.listInsetBottom);
    this.contentEl.toggleClass("ps-inset-left", s.listInsetLeft);
    this.contentEl.toggleClass("ps-inset-right", s.listInsetRight);
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ps-sidebar");
    this.applyListInset();
    root.toggleClass("is-mobile", Platform.isMobile);
    root.style.setProperty("--ps-nav-width", `${this.plugin.viewState.state.navWidth}px`);

    this.navEl = root.createDiv("ps-nav");
    const divider = root.createDiv("ps-divider");
    const list = root.createDiv("ps-list");
    this.headerEl = list.createDiv("ps-list-header");
    // Obsidian's own SearchComponent: the same pill, magnifier and clear
    // button as its other search fields. Built once — re-creating it on
    // every render would steal focus mid-typing.
    this.filterInput = new SearchComponent(list.createDiv("ps-search"))
      .setPlaceholder("Filter")
      .onChange((value) => {
        this.search = value;
        this.resetScroll();
        this.renderList();
      });
    this.filtersEl = list.createDiv("ps-filters");
    this.bodyEl = list.createDiv("ps-list-body");

    this.makeResizable(divider);
    this.watchListWidth();
    this.unsubscribe = this.plugin.index.subscribe(() => this.onIndexChange());
    // Rebuilding the DOM between pointerdown and pointerup would swallow the
    // click; renders that come due meanwhile wait for the release. Only the
    // main button: a right-click opens a menu, and macOS's native menus take
    // the pointerup, which would leave every later render waiting.
    this.registerDomEvent(this.contentEl, "pointerdown", (evt) => {
      if (evt.button === 0) this.pointerHeld = true;
    });
    const release = () => {
      this.pointerHeld = false;
      if (this.renderWaiting) {
        this.renderWaiting = false;
        this.queueRender();
      }
    };
    this.registerDomEvent(window, "pointerup", release);
    this.registerDomEvent(window, "pointercancel", release);
    this.registerDomEvent(window, "blur", release);
    this.registerDomEvent(window, "contextmenu", release);
    this.watchBookmarks();
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    // Theme, light/dark or accent changes repaint the ribbon.
    this.matchSurface();
    this.registerEvent(this.app.workspace.on("css-change", () => this.matchSurface()));
    // The index tracks .md only; everything else (attachments, and bookmarked
    // canvases/bases) comes straight from the vault, so re-render ourselves.
    const onFile = (file: { path: string }) => {
      if (!/\.md$/i.test(file.path)) this.queueRender();
    };
    for (const name of ["create", "delete", "rename", "modify"] as const) {
      this.registerEvent(this.app.vault.on(name as "create", onFile));
    }
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.followRename(oldPath, file.path)));
    this.render();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    if (this.fitFrame !== null) window.cancelAnimationFrame(this.fitFrame);
    this.unsubscribe?.();
    this.unsubscribeBookmarks?.();
    this.disconnectObservers();
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  /** Index changes arrive in bursts (startup, folder renames); coalesce them. */
  private queueRender(): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      if (this.pointerHeld || this.popover) this.renderWaiting = true;
      else this.render();
    }, 150);
  }

  /**
   * While the index fills, a full render per batch would redo work
   * proportional to the whole vault every 150 ms. Draw the list once the
   * first batch is in (the most recent notes), then only move the progress
   * bar, and draw everything once more when the fill ends.
   */
  private onIndexChange(): void {
    const loading = this.plugin.index.loading;
    if (!loading) {
      this.drawnWhileLoading = false;
      this.queueRender();
    } else if (!this.drawnWhileLoading && this.plugin.index.size > 0) {
      this.drawnWhileLoading = true;
      this.queueRender();
    } else {
      const bar = this.headerEl.querySelector<HTMLElement>(".ps-loading");
      if (bar) this.showProgress(bar, loading);
      else this.queueRender(); // nothing drawn yet: cheap, the index is still empty
    }
  }

  private showProgress(bar: HTMLElement, loading: { done: number; total: number }): void {
    bar.setAttr("aria-label", `Reading notes: ${loading.done.toLocaleString()} of ${loading.total.toLocaleString()}`);
    bar.setCssProps({ "--ps-progress": `${Math.round((loading.done / Math.max(loading.total, 1)) * 100)}%` });
  }

  /**
   * Keep view state attached to what was renamed — here or in File
   * explorer: the selected folder, fold state of a renamed folder and its
   * subfolders, the task note filter, and the default task note. Otherwise
   * a rename would drop the user back to Notes and unfold everything.
   */
  private followRename(from: string, to: string): void {
    if (this.place.kind === "notebook") {
      this.place = { kind: "notebook", folder: renamedPath(this.place.folder, from, to) };
    }
    if (this.taskNoteFilter) this.taskNoteFilter = renamedPath(this.taskNoteFilter, from, to);
    const collapsed = this.plugin.viewState.state.collapsed;
    const renamed = collapsed.map((key) =>
      key.startsWith("notebook:") ? `notebook:${renamedPath(key.slice("notebook:".length), from, to)}` : key
    );
    if (renamed.some((key, i) => key !== collapsed[i])) this.plugin.viewState.update({ collapsed: renamed });
    const taskNote = this.plugin.settings.defaultTaskNote;
    if (taskNote && renamedPath(taskNote, from, to) !== taskNote) {
      void this.plugin.updateSettings({ defaultTaskNote: renamedPath(taskNote, from, to) });
    }
    this.queueRender();
  }

  /** Re-render everything, e.g. after a setting changed what's shown. */
  refresh(): void {
    this.render();
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
    this.taskNoteFilter = null;
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

  /**
   * Split the index into the user's notes and attachment companions. A note
   * is only folded under a file when it is `type: extracted-text` AND one of
   * its links resolves to an actual attachment — so it has a card to live
   * on. Everything else stays a note, including notes the user keeps inside
   * an Attachments folder and extracts whose source is gone: hiding a note
   * with nowhere else to find it would lose it from the sidebar entirely.
   */
  private partition(): Partitioned {
    const isAttachmentFolder = attachmentFolderMatcher(attachmentFolderSetting(this.app));
    const notes: NoteSummary[] = [];
    const companions = new Map<string, NoteSummary[]>();
    const boxes = new Map<string, Array<{ note: NoteSummary; box: OcrBox }>>();
    for (const note of this.plugin.index.all()) {
      const source = note.extracted ? this.sourceFile(note) : null;
      if (!source) {
        notes.push(note);
        for (const box of note.ocrBoxes) {
          const file = this.app.metadataCache.getFirstLinkpathDest(box.link, note.path);
          if (!file || DOCUMENT_EXTENSIONS.has(file.extension.toLowerCase())) continue;
          const list = boxes.get(file.path);
          if (list) list.push({ note, box });
          else boxes.set(file.path, [{ note, box }]);
        }
        continue;
      }
      const list = companions.get(source.path);
      if (list) list.push(note);
      else companions.set(source.path, [note]);
    }
    return { notes, companions, boxes, isAttachmentFolder };
  }

  /** All text extracted from each attachment, lower-cased: its companion
   * notes' and the OCR Extractor boxes under its embeds. */
  private extractedTexts({ companions, boxes }: Partitioned): Map<string, string> {
    const texts = new Map<string, string>();
    for (const [path, list] of companions) texts.set(path, list.map((n) => n.searchText).join(" "));
    for (const [path, list] of boxes) {
      const text = list.map((b) => b.box.text.toLowerCase()).join(" ");
      texts.set(path, texts.has(path) ? `${texts.get(path)} ${text}` : text);
    }
    return texts;
  }

  /** The first of a companion's links that resolves to an attachment file. */
  private sourceFile(note: NoteSummary): TFile | null {
    for (const link of note.sourceLinks) {
      const file = this.app.metadataCache.getFirstLinkpathDest(link, note.path);
      if (file && !DOCUMENT_EXTENSIONS.has(file.extension.toLowerCase())) return file;
    }
    return null;
  }

  private attachmentFiles(): AttachmentFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => !DOCUMENT_EXTENSIONS.has(f.extension.toLowerCase()))
      .map((f) => ({
        path: f.path,
        name: f.name,
        folder: !f.parent || f.parent.isRoot() ? "" : f.parent.path,
        extension: f.extension.toLowerCase(),
        size: f.stat.size,
        mtime: f.stat.mtime,
        ctime: f.stat.ctime,
      }));
  }

  private currentFolder(): string | null {
    return this.place.kind === "notebook" ? this.place.folder : null;
  }

  // ---------- nav column ----------

  /**
   * Bookmarks live outside the index; refresh the nav when they change. The
   * listener belongs to the Bookmarks plugin's current instance, which is
   * replaced when the user toggles that core plugin — so re-attach whenever
   * the instance differs from the one we're watching.
   */
  private watchBookmarks(): void {
    const instance = bookmarksInstance(this.app);
    if (instance === this.watchedBookmarks) return;
    this.unsubscribeBookmarks?.();
    this.watchedBookmarks = instance;
    this.unsubscribeBookmarks = onBookmarksChanged(this.app, () => this.renderNav());
  }

  private renderNav(): void {
    this.watchBookmarks();
    const nav = this.navEl;
    nav.empty();
    const { notes, isAttachmentFolder } = this.partition();
    const templates = templateOptions(this.app).folder;
    const unfiltered = this.queryOptions("");

    // Evernote-style action row: the Note pill, then round icon buttons. The
    // row and each button can be turned off in settings; a round button
    // that's off moves into the ⋯ menu.
    const s = this.plugin.settings;
    const show = (on: boolean) => s.showActionRow && on;
    const showSearchButton = show(s.showSearchButton);
    const showNewFolderButton = show(s.showNewFolderButton);
    const showNewTaskButton = show(s.showNewTaskButton);
    const anyButton =
      show(s.showNoteButton) || showSearchButton || showNewFolderButton || showNewTaskButton || show(s.showMoreButton);
    const actions = anyButton ? nav.createDiv("ps-nav-actions") : createDiv();
    if (show(s.showNoteButton)) {
      const newNote = actions.createDiv("ps-new-note");
      setIcon(newNote.createSpan("ps-nav-icon"), "file-plus-2");
      newNote.createSpan({ text: "Note" });
      newNote.addEventListener("click", () => void createNote(this.app, this.currentFolder()));
    }
    if (showSearchButton) {
      this.roundButton(actions, "search", "Search everywhere", () => this.openSearch()).addClass("is-accent");
    }
    // Optional: on a narrow column these give way, and the ⋯ menu offers them.
    const newFolder = showNewFolderButton
      ? this.roundButton(actions, "folder-plus", "New folder", () => this.newNotebook(isAttachmentFolder))
      : null;
    const newTask = showNewTaskButton
      ? this.roundButton(actions, "list-checks", "New task", () => void this.newTask())
      : null;
    newFolder?.addClass("is-optional");
    newTask?.addClass("is-optional");
    if (show(s.showMoreButton)) this.roundButton(actions, "more-horizontal", "More", (evt) =>
      this.moreMenu(
        evt,
        tagRows(notes).map((t) => t.path),
        {
          search: !showSearchButton,
          folder: !newFolder || newFolder.offsetParent === null,
          task: !newTask || newTask.offsetParent === null,
        },
        isAttachmentFolder
      )
    );

    const bookmarks = readBookmarks(this.app);
    if (bookmarks && bookmarks.length && this.navHeading(nav, "Bookmarks", "bookmark", "section:bookmarks")) {
      for (const b of bookmarks) this.bookmarkRow(nav, b);
    }

    const noteCount = notesFor(notes, { kind: "notes" }, unfiltered).length;
    const openTasks = taskRows(
      notes,
      "open",
      localISODate(),
      templates,
      this.plugin.settings.boardCardsInTasks
    ).length;
    const templateCount = templates
      ? notesFor(notes, { kind: "templates" }, unfiltered).length
      : null;
    this.placeRow(nav, "Notes", "file-text", { kind: "notes" }, 0, noteCount, () => void createNote(this.app, null));
    this.placeRow(nav, "Tasks", "check-circle-2", { kind: "tasks" }, 0, openTasks, () => void this.newTask());
    this.placeRow(nav, "Attachments", "paperclip", { kind: "attachments" }, 0, this.attachmentFiles().length);
    this.placeRow(nav, "Templates", "layout-template", { kind: "templates" }, 0, templateCount);

    const notebooks = folderRows(this.plugin.indexer.folders(), notes, templates, isAttachmentFolder);
    if (this.navHeading(nav, "Folders", "folder", "section:notebooks", () => this.newNotebook(isAttachmentFolder))) {
      this.treeSection(nav, notebooks, "notebook", (row) => ({ kind: "notebook", folder: row.path }), "folder");
    }

    const tags = tagRows(notes);
    if (this.navHeading(nav, "Tags", "tag", "section:tags", () => this.newTag(tags.map((t) => t.path)))) {
      this.treeSection(nav, tags, "tag", (row) => ({ kind: "tag", tag: row.path }));
    }
  }

  /**
   * A section heading that folds its section. Its icon turns into a fold
   * chevron on hover; `onAdd` adds a "+" on the right, also shown on hover.
   * Returns whether the section is expanded.
   */
  private navHeading(
    parent: HTMLElement,
    label: string,
    icon: string,
    key: string,
    onAdd?: (evt: MouseEvent) => void
  ): boolean {
    const collapsed = this.isCollapsed(key);
    const el = parent.createDiv("ps-nav-heading is-foldable");
    el.toggleClass("is-collapsed", collapsed);
    this.foldSlot(el, icon, collapsed);
    el.createSpan({ cls: "ps-nav-label", text: label });
    if (onAdd) this.addButton(el, `New ${label.toLowerCase().replace(/s$/, "")}`, onAdd);
    el.addEventListener("click", () => this.toggleCollapsed(key));
    return !collapsed;
  }

  /** Icon slot that shows `icon` normally and a fold chevron on hover. */
  private foldSlot(row: HTMLElement, icon: string | null, collapsed: boolean): HTMLElement {
    const slot = row.createSpan("ps-nav-icon ps-fold-slot");
    if (icon) setIcon(slot.createSpan("ps-fold-icon"), icon);
    const chevron = slot.createSpan("ps-nav-chevron");
    chevron.toggleClass("is-collapsed", collapsed);
    setIcon(chevron, "chevron-down");
    return slot;
  }

  private roundButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (evt: MouseEvent) => void
  ): HTMLElement {
    const button = parent.createDiv({ cls: "ps-round-button", attr: { "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * Ways to create a board, for each board plugin that's enabled (its create
   * command is registered only then). Boards go in the folder being viewed.
   */
  private boardMakers(): Array<{ label: string; icon: string; make: () => void }> {
    const folder = this.currentFolder();
    const run = (make: () => Promise<void>) => () =>
      void make().catch((err: Error) => new Notice(`Couldn't create the board: ${err.message}`));
    const makers: Array<{ label: string; icon: string; make: () => void }> = [];
    if (hasCommand(this.app, KANBAN_NEW_BOARD)) {
      makers.push({ label: "New Kanban board", icon: "kanban", make: run(() => newKanbanBoard(this.app, folder)) });
    }
    if (hasCommand(this.app, TASK_LIST_KANBAN_NEW_BOARD)) {
      makers.push({
        label: "New Task List Kanban board",
        icon: "square-kanban",
        make: run(() => createTaskListBoard(this.app, folder)),
      });
    }
    return makers;
  }

  private moreMenu(
    evt: MouseEvent,
    tags: string[],
    hidden: { search: boolean; folder: boolean; task: boolean },
    isAttachmentFolder: (folder: string) => boolean
  ): void {
    const menu = new Menu();
    const folder = this.currentFolder();
    // Round buttons that aren't in the row: turned off in settings, or
    // (New folder, New task) given way on a narrow column.
    if (hidden.search) {
      menu.addItem((i) => i.setTitle("Search everywhere…").setIcon("search").onClick(() => this.openSearch()));
    }
    if (hidden.folder) {
      menu.addItem((i) => i.setTitle("New folder…").setIcon("folder-plus").onClick(() => this.newNotebook(isAttachmentFolder)));
    }
    if (hidden.task) {
      menu.addItem((i) => i.setTitle("New task…").setIcon("list-checks").onClick(() => void this.newTask()));
    }

    // Create
    menu.addItem((i) => i.setTitle("New tag…").setIcon("tag").onClick(() => this.newTag(tags)));
    menu.addItem((i) =>
      i
        .setTitle("New canvas")
        .setIcon("layout-dashboard")
        .onClick(() => void createCanvas(this.app, folder))
    );
    for (const board of this.boardMakers()) {
      menu.addItem((i) => i.setTitle(board.label).setIcon(board.icon).onClick(() => board.make()));
    }
    if (hasCommand(this.app, INSERT_TEMPLATE)) {
      menu.addItem((i) =>
        i
          .setTitle("Insert template")
          .setIcon("layout-template")
          .onClick(() => this.inNote(() => runCommand(this.app, INSERT_TEMPLATE)))
      );
    }

    // Navigate
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Open Obsidian search")
        .setIcon("search")
        .onClick(() => {
          if (!openGlobalSearch(this.app, "")) new Notice("The core Search plugin is turned off.");
        })
    );
    for (const [id, title, icon] of NAV_COMMANDS) {
      if (!hasCommand(this.app, id)) continue;
      menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => runCommand(this.app, id)));
    }
    if (hasCommand(this.app, IMPORTER)) {
      menu.addItem((i) => i.setTitle("Import…").setIcon("import").onClick(() => runCommand(this.app, IMPORTER)));
    }

    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Expand all").setIcon("chevrons-up-down").onClick(() => this.setAllCollapsed(false)));
    menu.addItem((i) => i.setTitle("Collapse all").setIcon("chevrons-down-up").onClick(() => this.setAllCollapsed(true)));
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Remove bookmarks to deleted notes")
        .setIcon("bookmark-minus")
        .onClick(() => this.plugin.removeDeadBookmarks())
    );
    menu.addItem((i) =>
      i
        .setTitle("Plainsight settings")
        .setIcon("settings")
        .onClick(() => openSettingsTab(this.app, this.plugin.manifest.id))
    );
    menu.showAtMouseEvent(evt);
  }

  /**
   * Run an editor command against the note the user was last in. Clicking
   * the sidebar makes it the active leaf, and editor commands such as
   * Insert template act on the active note — so focus that note first.
   */
  private inNote(run: () => boolean): void {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf || leaf.view.getViewType() !== "markdown") {
      new Notice("Open a note first.");
      return;
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!run()) new Notice("Couldn't run that here. Put the cursor in a note and try again.");
  }

  /** Fold or unfold every section and nested folder/tag at once. */
  private setAllCollapsed(collapsed: boolean): void {
    if (collapsed) {
      const { notes, isAttachmentFolder } = this.partition();
      const templates = templateOptions(this.app).folder;
      const parents = (rows: TreeRow[], prefix: string) =>
        visibleRows(rows, new Set())
          .filter((r) => r.hasChildren)
          .map((r) => `${prefix}:${r.path}`);
      this.plugin.viewState.update({
        collapsed: [
          "section:bookmarks",
          "section:notebooks",
          "section:tags",
          ...parents(folderRows(this.plugin.indexer.folders(), notes, templates, isAttachmentFolder), "notebook"),
          ...parents(tagRows(notes), "tag"),
        ],
      });
    } else {
      this.plugin.viewState.update({ collapsed: [] });
    }
    this.renderNav();
  }

  private addButton(row: HTMLElement, label: string, onAdd: (evt: MouseEvent) => void): void {
    const plus = row.createSpan({ cls: "ps-nav-add", attr: { "aria-label": label } });
    setIcon(plus, "plus-circle");
    plus.addEventListener("click", (evt) => {
      evt.stopPropagation();
      onAdd(evt);
    });
  }

  private isCollapsed(key: string): boolean {
    return this.plugin.viewState.state.collapsed.includes(key);
  }

  private toggleCollapsed(key: string): void {
    this.setCollapsed(key, !this.isCollapsed(key));
    this.renderNav();
  }

  /** Record a fold state without re-rendering (callers render once after). */
  private setCollapsed(key: string, collapsed: boolean): void {
    const list = this.plugin.viewState.state.collapsed;
    if (collapsed === list.includes(key)) return;
    this.plugin.viewState.update({ collapsed: collapsed ? [...list, key] : list.filter((k) => k !== key) });
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
    count: number | null,
    onAdd?: (evt: MouseEvent) => void
  ): void {
    const row = this.navRow(parent, label, icon, depth, count, this.isActive(place));
    if (onAdd) this.addButton(row, `New ${label.toLowerCase().replace(/s$/, "")}`, onAdd);
    row.addEventListener("click", () => this.setPlace(place));
  }

  /** Indented rows; parents get a chevron that folds their children. */
  private treeSection(
    parent: HTMLElement,
    rows: TreeRow[],
    keyPrefix: string,
    toPlace: (row: TreeRow) => Place,
    /** Shown on every row; on parents it gives way to the fold chevron on hover. */
    icon: string | null = null
  ): void {
    const collapsed = new Set(
      this.plugin.viewState.state.collapsed
        .filter((k) => k.startsWith(`${keyPrefix}:`))
        .map((k) => k.slice(keyPrefix.length + 1))
    );
    for (const row of visibleRows(rows, collapsed)) {
      const place = toPlace(row);
      const el = this.navRow(parent, row.name, icon, row.depth + 1, row.count, this.isActive(place));
      const key = `${keyPrefix}:${row.path}`;
      if (place.kind === "notebook") {
        el.addEventListener("contextmenu", (evt) => {
          const folder = this.app.vault.getAbstractFileByPath(place.folder);
          if (folder instanceof TFolder) this.fileMenu(evt, folder);
        });
      }
      el.addEventListener("click", () => {
        if (!row.hasChildren) return this.setPlace(place);
        // A parent is a place and a group: the first click selects it (and
        // opens it if folded); clicking it again while selected folds or
        // unfolds it, like a section heading.
        if (this.isActive(place)) return this.toggleCollapsed(key);
        if (row.collapsed) this.setCollapsed(key, false);
        this.setPlace(place);
      });
      if (!row.hasChildren) continue;
      // Swap the icon slot for one that shows the chevron on hover.
      el.addClass("is-foldable");
      const slot = this.foldSlot(el, icon, row.collapsed);
      el.querySelector(".ps-nav-icon")!.replaceWith(slot);
      slot.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.toggleCollapsed(key);
      });
    }
  }

  private bookmarkRow(parent: HTMLElement, bookmark: Bookmark): void {
    const icon =
      bookmark.kind === "folder" ? "folder" : bookmark.kind === "search" ? "search" : "file-text";
    const target = bookmark.kind === "search" ? null : this.app.vault.getAbstractFileByPath(bookmark.target);
    // Obsidian keeps a bookmark after its note is deleted; show it, but say so.
    const missing = bookmark.kind !== "search" && !target;
    const row = this.navRow(parent, bookmark.title, icon, 1, null, false);
    // The bookmark's group, where folders show their count.
    if (bookmark.group) row.createSpan({ cls: "ps-nav-count ps-nav-group", text: bookmark.group });
    row.toggleClass("is-missing", missing);
    if (missing) row.setAttribute("aria-label", `Deleted: ${bookmark.target}. Click to remove the bookmark.`);
    const menu = (evt: MouseEvent) => {
      evt.preventDefault();
      const m = new Menu();
      m.addItem((item) =>
        item
          .setTitle("Remove bookmark")
          .setIcon("bookmark-minus")
          .onClick(() => {
            if (!removeBookmark(this.app, bookmark)) {
              new Notice("Couldn't remove it: the Bookmarks plugin didn't respond as expected.");
            }
          })
      );
      m.showAtMouseEvent(evt);
    };
    row.addEventListener("contextmenu", menu);
    row.addEventListener("click", (evt) => {
      if (missing) {
        // Nothing to open; offer the one useful action right here.
        menu(evt);
      } else if (bookmark.kind === "folder" && target instanceof TFolder) {
        this.setPlace({ kind: "notebook", folder: target.path });
      } else if (bookmark.kind === "search") {
        openGlobalSearch(this.app, bookmark.target);
      } else if (target instanceof TFile) {
        // openLinkText honours a heading/block subpath; openFile would not.
        void this.app.workspace.openLinkText(
          `${target.path}${bookmark.subpath}`,
          "",
          Keymap.isModEvent(evt)
        );
      }
    });
  }

  // ---------- "+" flows ----------

  /** Our quick-add dialog; the finished task is appended as one line. */
  private async newTask(): Promise<void> {
    const target = await this.taskNote();
    if (!target) return;
    const add = async (file: TFile, line: string) => {
      if (!line.trim()) return; // cancelled
      try {
        await addTaskLine(this.app, file, line);
        new Notice(`Task added to ${file.basename}`);
      } catch (err) {
        new Notice(`Couldn't add the task to ${file.basename}: ${(err as Error).message}\n${line}`, 0);
      }
    };
    const today = localISODate();
    const options = await tasksLineOptions(this.app, today);
    // Tasks is installed but its settings can't be read: we can't write a
    // line it would accept, so use its own dialog.
    if (options === null) {
      void tasksCreateModal(this.app)?.then((line) => add(target, line), () => undefined);
      return;
    }
    new QuickTaskModal(this.app, target, today, options, (task) => void add(task.target, task.line)).open();
  }

  /** The default task note; the first time (or if it's gone), ask and remember. */
  private taskNote(): Promise<TFile | null> {
    const current = this.app.vault.getAbstractFileByPath(this.plugin.settings.defaultTaskNote);
    // Only a plain Markdown note: appending to a canvas, base or PDF would
    // corrupt it, and in a Kanban board the task would be hidden.
    if (current instanceof TFile && canHoldTasks(this.app, current)) return Promise.resolve(current);
    return new Promise((resolve) => {
      new NotePickerModal(this.app, "Choose the note new tasks are added to", (file) => {
        void this.plugin.updateSettings({ defaultTaskNote: file.path });
        new Notice(`New tasks will go to ${file.basename}. Change it in Plainsight settings.`);
        resolve(file);
      }).open();
    });
  }

  private newNotebook(isAttachmentFolder: (folder: string) => boolean, parentFolder?: string): void {
    const templates = templateOptions(this.app).folder;
    const folders = this.plugin.indexer
      .folders()
      .filter((f) => !isAttachmentFolder(f) && !(templates && (f === templates || f.startsWith(`${templates}/`))))
      .sort(compareNames);
    const parent = parentFolder ?? (this.place.kind === "notebook" ? this.place.folder : "");
    new NotebookModal(this.app, folders, parent, (path) => {
      void this.app.vault.createFolder(path).then(
        () => this.setPlace({ kind: "notebook", folder: path }),
        (err: Error) => new Notice(`Couldn't create the folder: ${err.message}`)
      );
    }).open();
  }

  private newTag(existing: string[]): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("Open a note first: a new tag is added to the note you're in.");
      return;
    }
    new TagModal(this.app, file.basename, existing, (tag) => {
      void addTagToNote(this.app, file, tag).then((added) => {
        if (added) this.setPlace({ kind: "tag", tag: tag.toLowerCase() });
        else
          new Notice(
            `"${file.basename}" has a tags property Plainsight won't edit automatically ` +
              "(comments or a multi-line list). Add the tag in the note's Properties instead.",
            8000
          );
      });
    }).open();
  }

  // ---------- divider ----------

  private makeResizable(divider: HTMLElement): void {
    divider.addEventListener("mousedown", (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startWidth = this.navEl.getBoundingClientRect().width;
      let width = startWidth;
      const move = (evt: MouseEvent) => {
        width = Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, startWidth + evt.clientX - startX));
        this.contentEl.style.setProperty("--ps-nav-width", `${width}px`);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        // Saved once, when the drag ends.
        this.plugin.viewState.update({ navWidth: Math.round(width) });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  // ---------- list column ----------

  // ---------- search everywhere ----------

  /** Search everywhere (the search window); `initial` pre-fills the query. */
  openSearch(initial = ""): void {
    new SearchModal(this.app, this.searchSource(), initial).open();
  }

  /**
   * Show a place with nothing narrowing its list (no Filter text or note
   * filter), its nav row unfolded, selected and scrolled into view, and the
   * sidebar revealed.
   */
  private showPlace(place: Place): void {
    const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    const unfold: string[] = [];
    if (place.kind === "notebook") {
      unfold.push("section:notebooks");
      for (let p = parentOf(place.folder); p; p = parentOf(p)) unfold.push(`notebook:${p}`);
    } else if (place.kind === "tag") {
      unfold.push("section:tags");
      for (let p = parentOf(place.tag); p; p = parentOf(p)) unfold.push(`tag:${p}`);
    }
    const collapsed = this.plugin.viewState.state.collapsed;
    if (unfold.some((key) => collapsed.includes(key))) {
      this.plugin.viewState.update({ collapsed: collapsed.filter((key) => !unfold.includes(key)) });
    }
    this.filterInput.setValue("");
    this.search = "";
    this.setPlace(place);
    void this.app.workspace.revealLeaf(this.leaf);
    this.navEl.querySelector(".ps-nav-item.is-active")?.scrollIntoView({ block: "nearest" });
  }

  /** A snapshot of what to search, taken when the window opens. */
  private searchSource(): SearchSource {
    const part = this.partition();
    const { notes, companions, boxes, isAttachmentFolder } = part;
    const extracted = this.extractedTexts(part);
    const templates = templateOptions(this.app).folder;
    const boards = this.plugin.settings.boardCardsInTasks;
    const today = localISODate();
    const open = (path: string, newTab: boolean) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) void openFile(this.app, file, newTab ? "tab" : false);
    };
    const card = (path: string) => () =>
      Array.from(this.bodyEl.querySelectorAll<HTMLElement>(".ps-card")).find((el) => el.dataset.path === path);
    const tags = new Map<string, string>();
    for (const note of notes) for (const tag of note.tags) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
    return {
      notes: () => notes,
      taskRows: () => [
        ...taskRows(notes, "open", today, templates, boards),
        ...taskRows(notes, "done", today, templates, boards),
      ],
      attachments: () =>
        this.attachmentFiles().map((file) => ({
          file,
          extracted: extracted.get(file.path) ?? "",
          companion: companions.get(file.path)?.[0]?.path ?? null,
          boxText: boxes.get(file.path)?.map((b) => b.box.text).join("\n") ?? null,
        })),
      folders: () =>
        this.plugin.indexer
          .folders()
          .filter((f) => !isAttachmentFolder(f) && !(templates && (f === templates || f.startsWith(`${templates}/`))))
          .sort(compareNames),
      tags: () => [...tags.values()].sort(compareNames),
      // A note: its folder in the nav (Notes for the vault root, Templates for
      // a template), with the note's card selected, and the note open.
      openNote: (path, newTab) => {
        const note = this.plugin.index.get(path);
        let place: Place = { kind: "notes" };
        if (note && templates && inFolder(note.folder, templates)) place = { kind: "templates" };
        else if (note?.folder) place = { kind: "notebook", folder: note.folder };
        // A remembered kind filter that leaves this note out would hide it here too.
        const kind = this.plugin.viewState.state.noteKindFilter;
        if (note && kind !== "all" && kind !== note.kind) this.plugin.viewState.update({ noteKindFilter: "all" });
        this.showPlace(place);
        this.revealInList(card(path))?.addClass("is-active");
        open(path, newTab);
      },
      // A task: the Tasks list on the tab that holds it, the task selected,
      // and its note open with the caret on it.
      openTask: (row, newTab) => {
        const closed = isClosed(row.task);
        const tab = this.plugin.viewState.state.taskFilter;
        if (closed ? tab !== "done" : tab === "done") this.plugin.viewState.update({ taskFilter: closed ? "done" : "open" });
        this.plugin.activeTask = { path: row.note.path, line: row.task.line };
        this.showPlace({ kind: "tasks" });
        this.revealInList(() => this.taskRowEls.get(`${row.note.path}\u0000${row.task.line}`));
        this.markActiveTask();
        void this.openTaskIn(row.note.path, row.task.line, newTab ? "tab" : false);
      },
      openAttachment: (path, newTab) => {
        this.showPlace({ kind: "attachments" });
        this.revealInList(card(path))?.addClass("is-active");
        open(path, newTab);
      },
      openFolder: (path) => this.showPlace({ kind: "notebook", folder: path }),
      // Tag places are keyed by the lower-cased tag path, like the nav's rows.
      openTag: (tag) => this.showPlace({ kind: "tag", tag: tag.toLowerCase() }),
      showInList: (list, filter) => {
        this.showPlace({ kind: list });
        this.filterInput.setValue(filter);
        this.search = filter;
        this.resetScroll();
        this.renderList();
      },
      obsidianSearch: (query) => {
        if (!openGlobalSearch(this.app, query)) new Notice("The core Search plugin is turned off.");
      },
      tasksAvailable: () => hasTasksPlugin(this.app),
      // Into the note last edited, on lines of its own at the caret; with no
      // note open, onto the clipboard instead.
      insertTasksQuery: (block) => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const view = leaf?.view;
        if (!(view instanceof MarkdownView)) {
          void navigator.clipboard.writeText(block).then(
            () => new Notice("No note is open, so the Tasks query was copied instead."),
            () => new Notice("Open a note to insert the Tasks query into.")
          );
          return;
        }
        this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        // After the caret's line if it has text, else on it; with a blank line
        // between the block and any text above. One edit, so one undo.
        const editor = view.editor;
        const { line } = editor.getCursor();
        const text = editor.getLine(line);
        const above = text.trim() !== "" || (line > 0 && editor.getLine(line - 1).trim() !== "");
        const at = { line, ch: text.trim() ? text.length : 0 };
        editor.replaceRange(`${text.trim() ? "\n" : ""}${above ? "\n" : ""}${block}\n`, at);
      },
    };
  }

  private renderList(): void {
    const what = { tasks: "tasks", attachments: "attachments", templates: "templates" } as Record<string, string>;
    this.filterInput.setPlaceholder(`Search ${what[this.place.kind] ?? "notes"}`);
    this.disconnectObservers();
    this.taskRowEls.clear();
    this.activeTaskEl = null;
    const scroll = this.bodyEl.scrollTop;
    this.headerEl.empty();
    this.filtersEl.empty();
    this.bodyEl.empty();


    if (this.place.kind === "tasks") {
      this.renderTasks();
    } else if (this.place.kind === "attachments") {
      this.renderAttachments();
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
    const view = this.plugin.viewState.state;
    const everything = notesFor(this.partition().notes, this.place, this.queryOptions());
    const counts = kindCounts(everything);
    // A remembered kind this place doesn't have would show an empty list
    // with no visible cause; fall back to all.
    const kind = view.noteKindFilter !== "all" && counts[view.noteKindFilter] ? view.noteKindFilter : null;
    const list = kind ? everything.filter((n) => n.kind === kind) : everything;
    const grouping: NoteGrouping = view.noteGroupBy;
    this.renderHeader(this.placeTitle(), list.length);
    this.kindChips(counts, kind);
    if (!list.length) {
      const text = this.plugin.index.loading ? "Loading notes…" : this.search ? "No matches" : "No notes";
      this.bodyEl.createDiv({ cls: "ps-empty", text });
      return;
    }
    const items: ListItem[] = [];
    for (const group of groupNotesBy(list, this.sort, grouping)) {
      if (group.label) items.push({ label: group.label });
      for (const note of group.notes) items.push({ note });
    }
    this.renderIncrementally(items.length, (i) => {
      const item = items[i];
      if ("label" in item) this.bodyEl.createDiv({ cls: "ps-group-label", text: item.label });
      else if ("note" in item) this.renderCard(item.note);
    });
  }

  /**
   * All · Notes · Boards · Canvases, with counts. Shown only when the place
   * holds more than one kind — a folder of plain notes needs no filter.
   */
  private kindChips(counts: Record<"note" | "board" | "canvas", number>, active: string | null): void {
    const kinds = (["note", "board", "canvas"] as const).filter((k) => counts[k] > 0);
    if (kinds.length < 2) return;
    const labels = { note: "Notes", board: "Boards", canvas: "Canvases" };
    const chip = (label: string, value: "all" | "note" | "board" | "canvas", count: number) => {
      const el = this.filtersEl.createDiv({ cls: "ps-filter" });
      el.createSpan({ text: label });
      el.createSpan({ cls: "ps-filter-count", text: String(count) });
      el.toggleClass("is-active", (active ?? "all") === value);
      el.addEventListener("click", () => {
        this.plugin.viewState.update({ noteKindFilter: value });
        this.resetScroll();
        this.renderList();
      });
    };
    chip("All", "all", counts.note + counts.board + counts.canvas);
    for (const k of kinds) chip(labels[k], k, counts[k]);
  }

  /** Render `count` items in batches as the user scrolls, not all at once. */
  private renderIncrementally(count: number, renderAt: (i: number) => void): void {
    let next = 0;
    let size = Math.max(BATCH, this.renderedCount);
    let sentinel: HTMLElement | null = null;
    let observer: IntersectionObserver | null = null;
    // Renders the next batch; true while more remain. Run by scrolling (the
    // sentinel), or directly to reach an item further down (revealInList).
    const step = (): boolean => {
      observer?.disconnect();
      sentinel?.remove();
      const end = Math.min(next + size, count);
      for (; next < end; next++) renderAt(next);
      this.renderedCount = next;
      size = BATCH;
      if (next >= count) {
        this.renderNext = null;
        return false;
      }
      const mark = (sentinel = this.bodyEl.createDiv("ps-sentinel"));
      const watcher = (observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting) && mark.isConnected) step();
        },
        { root: this.bodyEl }
      ));
      watcher.observe(mark);
      this.observers.push(watcher);
      return true;
    };
    this.renderNext = step;
    step();
  }

  /** Render batches until `find` turns up an element, then scroll to it. */
  private revealInList(find: () => HTMLElement | null | undefined): HTMLElement | null {
    let el = find() ?? null;
    while (!el && this.renderNext?.()) el = find() ?? null;
    el?.scrollIntoView({ block: "center" });
    return el;
  }

  private fitFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastBodyWidth = 0;

  /** Fit newly rendered cards' tag rows on the next frame, once per batch. */
  private queueFitTags(): void {
    if (this.fitFrame !== null) return;
    this.fitFrame = window.requestAnimationFrame(() => {
      this.fitFrame = null;
      this.fitTagRows();
    });
  }

  /**
   * Keep each card's meta row on one line: show as many tags as fit after
   * the date and badge, and fold the rest into "+N". All widths are read
   * first, then all rows written, so a batch costs one layout pass. Rows
   * are refitted only when the list's width changes.
   */
  private fitTagRows(): void {
    const rows = Array.from(this.bodyEl.querySelectorAll<HTMLElement>('.ps-card-meta[data-fit="pending"]'));
    if (!rows.length) return;
    const GAP = 6;
    const MORE = 34; // room kept for a "+N" chip
    // Reset phase (writes only): show everything again before measuring.
    for (const row of rows) {
      for (const el of Array.from(row.children) as HTMLElement[]) el.style.display = "";
    }
    // Read phase (reads only): one layout for the whole batch.
    const plans = rows.map((row) => {
      const children = Array.from(row.children) as HTMLElement[];
      const tags = children.filter((el) => el.hasClass("ps-card-tag"));
      const fixed = children.filter((el) => !el.hasClass("ps-card-tag") && !el.hasClass("ps-card-more"));
      return {
        row,
        tags,
        available: row.clientWidth,
        fixedWidth: fixed.reduce((sum, el) => sum + el.offsetWidth + GAP, 0),
        tagWidths: tags.map((el) => el.offsetWidth),
      };
    });
    // Write phase.
    for (const { row, tags, available, fixedWidth, tagWidths } of plans) {
      let used = fixedWidth;
      let shown = 0;
      for (let i = 0; i < tags.length; i++) {
        const reserve = i < tags.length - 1 ? MORE : 0;
        if (used + tagWidths[i] + GAP + reserve > available) break;
        used += tagWidths[i] + GAP;
        shown++;
      }
      tags.forEach((el, i) => (el.style.display = i < shown ? "" : "none"));
      const more = row.querySelector<HTMLElement>(".ps-card-more");
      if (more) {
        const hidden = tags.length - shown;
        more.textContent = hidden ? `+${hidden}` : "";
        more.style.display = hidden ? "" : "none";
        if (hidden) more.title = tags.slice(shown).map((el) => el.textContent).join(", ");
      }
      row.dataset.fit = "done";
    }
  }

  /** Refit every rendered row when the list column changes width. */
  private watchListWidth(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width === this.lastBodyWidth) return;
      this.lastBodyWidth = width;
      this.bodyEl.querySelectorAll<HTMLElement>(".ps-card-meta").forEach((row) => (row.dataset.fit = "pending"));
      this.queueFitTags();
    });
    this.resizeObserver.observe(this.bodyEl);
  }

  private disconnectObservers(): void {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    this.renderNext = null;
  }

  private renderHeader(title: string, count: number | null): void {
    const row = this.headerEl.createDiv("ps-header-row");
    // Mobile shows one column at a time: a full-size back button in the
    // title row returns to the places list.
    if (Platform.isMobile) {
      const back = row.createEl("button", { cls: "ps-back", attr: { "aria-label": "Back to places" } });
      setIcon(back, "chevron-left");
      back.addEventListener("click", () => {
        this.mobilePane = "nav";
        this.render();
      });
    }
    row.createSpan({ cls: "ps-title", text: title });
    if (count !== null) row.createSpan({ cls: "ps-count", text: String(count) });
    // While notes are still being read, counts are still growing: say so.
    const loading = this.plugin.index.loading;
    if (loading && loading.total > 0) {
      this.showProgress(this.headerEl.createDiv({ cls: "ps-loading", attr: { role: "progressbar" } }), loading);
    }
    const actions = row.createDiv("ps-actions");

    // The first button creates what this place lists: a task on Tasks, a
    // note everywhere else.
    if (this.place.kind === "tasks") {
      const task = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "New task" } });
      setIcon(task, "list-checks");
      task.addEventListener("click", () => void this.newTask());
    } else {
      const add = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "New note" } });
      setIcon(add, "file-plus-2");
      add.addEventListener("click", () => void createNote(this.app, this.currentFolder()));
    }

    // New board: only for board plugins that are enabled. With one, a click
    // creates that kind; with both, it asks which.
    const boards = this.boardMakers();
    if (boards.length) {
      const label = boards.length === 1 ? boards[0].label : "New board";
      const board = actions.createDiv({ cls: "ps-action", attr: { "aria-label": label } });
      setIcon(board, "kanban");
      board.addEventListener("click", (evt) => {
        if (boards.length === 1) return boards[0].make();
        const menu = new Menu();
        for (const b of boards) menu.addItem((i) => i.setTitle(b.label).setIcon(b.icon).onClick(() => b.make()));
        menu.showAtMouseEvent(evt);
      });
    }

    if (this.place.kind === "tasks") {
      const group = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "Group by" } });
      setIcon(group, "group");
      group.addEventListener("click", (evt) => this.groupMenu(evt));
      return;
    }
    if (this.place.kind !== "attachments") {
      const group = actions.createDiv({ cls: "ps-action", attr: { "aria-label": "Group by" } });
      setIcon(group, "group");
      group.addEventListener("click", (evt) => this.noteGroupMenu(evt));
    }
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
      case "attachments":
        return "Attachments";
      case "notebook":
        return this.place.folder.split("/").pop()!;
      case "tag":
        return `#${this.place.tag}`;
    }
  }

  private renderCard(note: NoteSummary): void {
    const card = this.bodyEl.createDiv({ cls: "ps-card", attr: { "data-path": note.path } });
    card.toggleClass("is-active", this.activeFile()?.path === note.path);
    const text = card.createDiv("ps-card-text");

    const title = text.createDiv("ps-card-title");
    if (note.kind !== "note") {
      setIcon(title.createSpan("ps-card-kind"), note.kind === "board" ? "kanban" : "layout-dashboard");
    }
    title.createSpan({ text: note.title });
    if (note.pinned) setIcon(title.createSpan("ps-card-pin"), "pin");
    if (note.snippet) text.createDiv({ cls: "ps-card-snippet", text: note.snippet });

    // One line: date · task badge (or a board's/canvas's count) · tags,
    // with tags that don't fit folded into "+N" by fitTagRows().
    const meta = text.createDiv({ cls: "ps-card-meta", attr: { "data-fit": "pending" } });
    const time = this.sort === "created" ? note.ctime : note.mtime;
    meta.createSpan({ cls: "ps-card-date", text: cardDate(time) });
    const { closed, total } = taskProgress(note);
    if (note.taskListBoard) {
      // Its cards are tasks from other notes, chosen by that plugin's rules:
      // name the kind of board rather than guess a count.
      const chip = meta.createSpan("ps-card-tasks ps-card-items");
      setIcon(chip.createSpan(), "list-checks");
      chip.createSpan({ text: "Task List Kanban" });
    } else if (note.kind !== "note") {
      // Boards: card count (their checkboxes are cards, not progress);
      // canvases: how many boxes they hold.
      const label = note.kind === "board" ? "card" : "box";
      const chip = meta.createSpan("ps-card-tasks ps-card-items");
      setIcon(chip.createSpan(), note.kind === "board" ? "square-stack" : "shapes");
      chip.createSpan({ text: `${note.items} ${label}${note.items === 1 ? "" : label === "box" ? "es" : "s"}` });
    } else if (total) {
      const chip = meta.createSpan("ps-card-tasks");
      setIcon(chip.createSpan(), "check-circle-2");
      chip.createSpan({ text: `${closed}/${total}` });
    }
    for (const tag of note.tags) meta.createSpan({ cls: "ps-card-tag", text: tag });
    if (note.tags.length) meta.createSpan({ cls: "ps-card-more" });
    this.queueFitTags();

    const src = this.imageSrc(note);
    if (src) {
      card.createDiv("ps-card-thumb").createEl("img", { attr: { src, loading: "lazy", alt: "" } });
    }

    card.addEventListener("click", (evt) => {
      const file = this.app.vault.getAbstractFileByPath(note.path);
      if (!(file instanceof TFile)) return;
      // Only Markdown can seed a new note; a canvas "template" just opens.
      if (this.place.kind === "templates" && file.extension === "md") void createNote(this.app, null, file);
      else void openFile(this.app, file, Keymap.isModEvent(evt));
    });
    card.addEventListener("contextmenu", (evt) => this.cardMenu(evt, note));
    this.previewOnHover(card, note.path);
  }

  /**
   * Page Preview opens above or below the card, over the list. Put it to the
   * right of the card instead, centred on it, so the list stays in view.
   * Returns false when it doesn't fit there, leaving Obsidian's placement.
   */
  private placeBeside(hoverEl: HTMLElement, target: HTMLElement): boolean {
    const win = target.ownerDocument.defaultView;
    if (!win) return false;
    const margin = 10;
    const card = target.getBoundingClientRect();
    const left = card.right + margin;
    if (left + hoverEl.offsetWidth > win.innerWidth - margin) return false;
    hoverEl.style.maxHeight = `${win.innerHeight - 2 * margin}px`;
    const height = hoverEl.offsetHeight;
    const centred = card.top + card.height / 2 - height / 2;
    const top = Math.max(margin, Math.min(centred, win.innerHeight - height - margin));
    hoverEl.style.left = `${left}px`;
    hoverEl.style.top = `${top}px`;
    hoverEl.style.right = "";
    hoverEl.style.bottom = "";
    return true;
  }

  /**
   * Obsidian's Page Preview for `path` when the mouse rests on `el`, scrolled
   * to (and highlighting) `line` when given. Whether Cmd/Ctrl must be held is
   * the user's choice in Page Preview's settings. Mouse only: a tap on a
   * touch screen fires pointer events too, and shouldn't pop up a preview.
   */
  private previewOnHover(el: HTMLElement, path: string, line?: number): void {
    // Page Preview reads everything after a "#" as a heading, with no way to
    // escape it: "C# basics.md" would preview "C". Better no preview.
    if (path.includes("#")) return;
    el.addEventListener("pointerenter", (evt) => {
      if (evt.pointerType !== "mouse" || !this.plugin.settings.hoverPreviews) return;
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: SIDEBAR_VIEW,
        hoverParent: this,
        targetEl: el,
        linktext: path,
        state: line === undefined ? undefined : { scroll: line },
      });
    });
  }

  private cardMenu(evt: MouseEvent, note: NoteSummary): void {
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) return;
    this.fileMenu(evt, file, (menu) => {
      // Pinning writes a frontmatter line: fine for notes and boards
      // (Markdown), never for a canvas, whose JSON it would corrupt.
      if (note.kind !== "canvas") {
        menu.addItem((item) =>
          item
            .setTitle(note.pinned ? "Unpin note" : "Pin note")
            .setIcon(note.pinned ? "pin-off" : "pin")
            .onClick(() => void togglePin(this.app, file))
        );
      }
      if (this.place.kind === "templates") {
        menu.addItem((item) =>
          item
            .setTitle("Edit template")
            .setIcon("pencil")
            .onClick(() => void openFile(this.app, file, false))
        );
      }
    });
  }

  /**
   * The right-click menu for a file or folder, modelled on File explorer's.
   * Obsidian's views add Rename, Delete, New note etc. themselves and only
   * then trigger "file-menu" for other plugins' items — triggering the event
   * alone yields none of them. So the core items are added here, using the
   * public APIs (renameFile via RenameModal; promptForDeletion, which shows
   * Obsidian's own confirmation and honours its trash setting), and the
   * event follows for plugin items (Move to…, Bookmark…, Merge…). The source
   * is File explorer's, as this sidebar stands in for it and some plugins
   * only add their folder items for that source.
   */
  private fileMenu(evt: MouseEvent, file: TAbstractFile, extra?: (menu: Menu) => void): void {
    evt.preventDefault();
    evt.stopPropagation();
    const menu = new Menu();
    if (file instanceof TFolder) {
      menu.addItem((i) =>
        i
          .setTitle("New note")
          .setIcon("file-plus-2")
          .onClick(() => void createNote(this.app, file.path))
      );
      menu.addItem((i) =>
        i
          .setTitle("New folder")
          .setIcon("folder-plus")
          .onClick(() => this.newNotebook(this.partition().isAttachmentFolder, file.path))
      );
    } else if (file instanceof TFile) {
      menu.addItem((i) =>
        i
          .setTitle("Open in new tab")
          .setIcon("file-plus")
          .onClick(() => void openFile(this.app, file, "tab"))
      );
      menu.addItem((i) =>
        i
          .setTitle("Open to the right")
          .setIcon("separator-vertical")
          .onClick(() => void openFile(this.app, file, "split"))
      );
    }
    if (extra) {
      menu.addSeparator();
      extra(menu);
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Rename…")
        .setIcon("pencil-line")
        .onClick(() => new RenameModal(this.app, file).open())
    );
    menu.addItem((i) =>
      i
        .setTitle("Delete")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => void this.app.fileManager.promptForDeletion(file))
    );
    menu.addSeparator();
    this.app.workspace.trigger("file-menu", menu, file, "file-explorer-context-menu", null);
    menu.showAtMouseEvent(evt);
  }

  private imageSrc(note: NoteSummary): string | null {
    const target = note.thumbnail;
    if (!target) return null;
    if (/^https?:\/\//i.test(target)) return target;
    const file = this.app.metadataCache.getFirstLinkpathDest(target, note.path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  private renderAttachments(): void {
    const part = this.partition();
    const { companions, boxes } = part;
    const files = attachmentsFor(this.attachmentFiles(), this.extractedTexts(part), this.search, this.sort);
    this.renderHeader("Attachments", files.length);
    if (!files.length) {
      this.bodyEl.createDiv({ cls: "ps-empty", text: this.search ? "No matches" : "No attachments" });
      return;
    }
    const items: ListItem[] = [];
    for (const group of groupNotes(files, this.sort)) {
      if (group.label) items.push({ label: group.label });
      for (const file of group.notes) items.push({ file });
    }
    this.renderIncrementally(items.length, (i) => {
      const item = items[i];
      if ("label" in item) this.bodyEl.createDiv({ cls: "ps-group-label", text: item.label });
      else if ("file" in item)
        this.renderAttachmentCard(item.file, companions.get(item.file.path) ?? [], boxes.get(item.file.path) ?? []);
    });
  }

  private renderAttachmentCard(
    file: AttachmentFile,
    companions: NoteSummary[],
    boxes: Array<{ note: NoteSummary; box: OcrBox }>
  ): void {
    const card = this.bodyEl.createDiv({ cls: "ps-card", attr: { "data-path": file.path } });
    card.toggleClass("is-active", this.activeFile()?.path === file.path);
    const text = card.createDiv("ps-card-text");
    text.createDiv({ cls: "ps-card-title", text: file.name });
    // The extracted text is the best preview of what the file says.
    const snippet =
      companions.find((c) => c.snippet)?.snippet ??
      boxes.map((b) => extractSnippet(b.box.text)).find(Boolean);
    if (snippet) text.createDiv({ cls: "ps-card-snippet", text: snippet });
    const meta = text.createDiv("ps-card-meta");
    meta.createSpan({ cls: "ps-card-tag", text: file.extension.toUpperCase() });
    meta.createSpan({ text: formatSize(file.size) });
    meta.createSpan({ cls: "ps-card-date", text: cardDate(this.sort === "created" ? file.ctime : file.mtime) });
    const parent = file.folder.split("/").filter((p) => !/^attachments$/i.test(p)).pop();
    if (parent) meta.createSpan({ text: parent });

    const tfile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(tfile instanceof TFile)) return;
    if (/^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(file.extension)) {
      card
        .createDiv("ps-card-thumb")
        .createEl("img", { attr: { src: this.app.vault.getResourcePath(tfile), loading: "lazy", alt: "" } });
    } else {
      setIcon(card.createDiv("ps-card-thumb ps-card-fileicon"), file.extension === "pdf" ? "file-text" : "file");
    }

    card.addEventListener("click", (evt) => void openFile(this.app, tfile, Keymap.isModEvent(evt)));
    this.previewOnHover(card, tfile.path);
    card.addEventListener("contextmenu", (evt) =>
      this.fileMenu(evt, tfile, (menu) => {
        // Notes that embed or link the file, opened where they mention it;
        // greyed out when no note does.
        const containing = this.containingNotes(tfile);
        if (!containing.length) {
          menu.addItem((item) => item.setTitle("Open containing note").setIcon("link").setDisabled(true));
        }
        for (const { file: note, line } of containing.slice(0, MAX_CONTAINING)) {
          menu.addItem((item) =>
            item
              .setTitle(containing.length > 1 ? `Open containing note: ${note.basename}` : "Open containing note")
              .setIcon("link")
              .onClick(() => void openFile(this.app, note, false, line))
          );
        }
        if (containing.length > MAX_CONTAINING) {
          const more = containing.length - MAX_CONTAINING;
          menu.addItem((item) => item.setTitle(`…and ${more} more note${more === 1 ? "" : "s"}`).setDisabled(true));
        }
        for (const companion of companions) {
          menu.addItem((item) =>
            item
              .setTitle(companions.length > 1 ? `Open extracted text: ${companion.title}` : "Open extracted text")
              .setIcon("text")
              .onClick(() => {
                const note = this.app.vault.getAbstractFileByPath(companion.path);
                if (note instanceof TFile) void openFile(this.app, note, false);
              })
          );
        }
        // The notes whose OCR Extractor box holds the file's text, opened at the box.
        for (const { note, box } of boxes) {
          menu.addItem((item) =>
            item
              .setTitle(boxes.length > 1 ? `Open extracted text: ${note.title}` : "Open extracted text")
              .setIcon("scan-text")
              .onClick(() => {
                const host = this.app.vault.getAbstractFileByPath(note.path);
                if (host instanceof TFile) void openFile(this.app, host, false, box.line);
              })
          );
        }
      })
    );
  }

  /**
   * Notes that embed or link `file`, by name, each with the line of its
   * first mention. Extracted-text notes don't count: they're the file's
   * text, reached through "Open extracted text".
   */
  private containingNotes(file: TFile): Array<{ file: TFile; line: number }> {
    const { metadataCache, vault } = this.app;
    const found: Array<{ file: TFile; line: number }> = [];
    for (const [source, targets] of Object.entries(metadataCache.resolvedLinks)) {
      if (!targets[file.path] || this.plugin.index.get(source)?.extracted) continue;
      const note = vault.getAbstractFileByPath(source);
      if (!(note instanceof TFile)) continue;
      const cache = metadataCache.getFileCache(note);
      const lines = [...(cache?.embeds ?? []), ...(cache?.links ?? [])]
        .filter((ref) => metadataCache.getFirstLinkpathDest(getLinkpath(ref.link), source)?.path === file.path)
        .map((ref) => ref.position.start.line);
      found.push({ file: note, line: lines.length ? Math.min(...lines) : 0 });
    }
    return found.sort((a, b) => compareNames(a.file.basename, b.file.basename));
  }

  private noteGroupMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const options: Array<[NoteGrouping, string, string]> = [
      ["date", "Date", "calendar"],
      ["folder", "Folder", "folder"],
      ["kind", "Type", "shapes"],
      ["none", "No grouping", "list"],
    ];
    for (const [key, label, icon] of options) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setIcon(icon)
          .setChecked(this.plugin.viewState.state.noteGroupBy === key)
          .onClick(() => {
            this.plugin.viewState.update({ noteGroupBy: key });
            this.resetScroll();
            this.renderList();
          })
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private groupMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const options: Array<[TaskGrouping, string, string]> = [
      ["due", "Due date", "calendar"],
      ["scheduled", "Scheduled date", "calendar-clock"],
      ["priority", "Priority", "flag"],
      ["recurrence", "Recurrence", "repeat"],
      ["tag", "Tag", "tag"],
      ["folder", "Folder", "folder"],
      ["note", "Note", "file-text"],
      ["board", "Kanban board", "kanban"],
      ["none", "No grouping", "list"],
    ];
    for (const [key, label, icon] of options) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setIcon(icon)
          .setChecked(this.plugin.viewState.state.taskGroupBy === key)
          .onClick(() => {
            this.plugin.viewState.update({ taskGroupBy: key });
            this.resetScroll();
            this.renderList();
          })
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private filterTasksTo(path: string | null): void {
    this.taskNoteFilter = path;
    this.resetScroll();
    this.renderList();
  }

  /** "All notes ▾" (pick one) or "Note title ✕" (clear) beside the status tabs. */
  private noteFilterChip(rows: Parameters<typeof notesOfTaskRows>[0]): void {
    const chip = this.filtersEl.createDiv("ps-filter ps-filter-note");
    const current = this.taskNoteFilter && rows.find((r) => r.note.path === this.taskNoteFilter)?.note;
    if (current) {
      chip.addClass("is-active");
      chip.createSpan({ text: current.title });
      const clear = chip.createSpan({ cls: "ps-filter-clear", attr: { "aria-label": "All notes" } });
      setIcon(clear, "x");
      clear.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.filterTasksTo(null);
      });
    } else {
      chip.createSpan({ text: "All notes" });
      setIcon(chip.createSpan("ps-filter-caret"), "chevron-down");
    }
    chip.addEventListener("click", () => {
      const entries = notesOfTaskRows(rows);
      new PickerModal(
        this.app,
        "Show tasks from note…",
        entries,
        (e) => `${e.note.title} (${e.count})`,
        (e) => this.filterTasksTo(e.note.path)
      ).open();
    });
  }

  /**
   * Move the highlight to the task under the cursor (or clear it). One map
   * lookup; only the old and new rows change, and it scrolls only when the
   * highlighted row changed. A row in a batch not rendered yet is left
   * alone rather than forcing the whole list to render.
   */
  markActiveTask(): void {
    if (this.place.kind !== "tasks") return;
    const active = this.plugin.activeTask;
    const el = active ? this.taskRowEls.get(`${active.path}\u0000${active.line}`) ?? null : null;
    if (el === this.activeTaskEl) return;
    this.activeTaskEl?.removeClass("is-active");
    this.activeTaskEl = el;
    if (el) {
      el.addClass("is-active");
      el.scrollIntoView({ block: "nearest" });
    }
  }

  /**
   * Open a task's note with the caret on the task's first letter, not at
   * the start of the line before "- [ ]". Obsidian's line state puts it at
   * column 0, so the column is set once the note is open.
   */
  private openTask(path: string, line: number, evt: MouseEvent): Promise<void> {
    return this.openTaskIn(path, line, Keymap.isModEvent(evt));
  }

  /** Open a note with the caret on a task's text, not before its "- [ ]". */
  private async openTaskIn(path: string, line: number, mode: PaneType | boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = await openFile(this.app, file, mode, line);
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const editor = view.editor;
    if (line >= editor.lineCount()) return;
    const ch = taskTextColumn(editor.getLine(line));
    editor.setCursor({ line, ch });
    editor.focus();
  }

  /**
   * The file open in the workspace. Clicking into a hover preview makes the
   * previewed note Obsidian's active file; that isn't the note that's open.
   */
  private activeFile(): TFile | null {
    const editor = this.app.workspace.activeEditor;
    if (editor && !(editor instanceof MarkdownView)) {
      const view = this.app.workspace.getMostRecentLeaf()?.view;
      return view instanceof FileView ? view.file : null;
    }
    return this.app.workspace.getActiveFile();
  }

  /** Cheap highlight update when a note is opened elsewhere. */
  private markActive(): void {
    const active = this.activeFile()?.path;
    this.bodyEl.querySelectorAll<HTMLElement>(".ps-card").forEach((el) => {
      el.toggleClass("is-active", el.dataset.path === active);
    });
  }

  // ---------- task rows ----------

  private renderTasks(): void {
    const today = localISODate();
    // Validated when loaded: anything unknown is already the default.
    const grouping: TaskGrouping = this.plugin.viewState.state.taskGroupBy;
    const all = taskRows(
      this.partition().notes,
      this.plugin.viewState.state.taskFilter,
      today,
      templateOptions(this.app).folder,
      // Grouping by board is an explicit ask for board cards.
      this.plugin.settings.boardCardsInTasks || grouping === "board"
    );
    // A note filter for a note that no longer has matching tasks would show
    // an empty list with no visible cause; drop it.
    if (this.taskNoteFilter && !all.some((r) => r.note.path === this.taskNoteFilter)) {
      this.taskNoteFilter = null;
    }
    const rows = filterTaskRows(all, this.search, this.taskNoteFilter);
    // Count what's shown: board grouping drops tasks from ordinary notes.
    const groups = groupTaskRows(rows, grouping, today);
    this.renderHeader("Tasks", groups.reduce((n, g) => n + g.rows.length, 0));

    const filters: Array<[TaskFilter, string]> = [
      ["open", "Open"],
      ["overdue", "Overdue"],
      ["done", "Done"],
    ];
    // Each tab counts what it would show under the current search and note
    // filter (the note filter only narrows if that note has tasks there).
    const notes = this.partition().notes;
    const templates = templateOptions(this.app).folder;
    const withBoards = this.plugin.settings.boardCardsInTasks || grouping === "board";
    const countFor = (filter: TaskFilter): number => {
      const rowsFor = taskRows(notes, filter, today, templates, withBoards);
      const note = this.taskNoteFilter && rowsFor.some((r) => r.note.path === this.taskNoteFilter) ? this.taskNoteFilter : null;
      const visible = filterTaskRows(rowsFor, this.search, note);
      return grouping === "board" ? visible.filter((r) => holdsCards(r.note)).length : visible.length;
    };
    for (const [key, label] of filters) {
      const tab = this.filtersEl.createDiv({ cls: "ps-filter" });
      tab.createSpan({ text: label });
      tab.createSpan({ cls: "ps-filter-count", text: String(countFor(key)) });
      tab.toggleClass("is-active", this.plugin.viewState.state.taskFilter === key);
      tab.addEventListener("click", () => {
        this.plugin.viewState.update({ taskFilter: key });
        this.resetScroll();
        this.renderList();
      });
    }

    this.noteFilterChip(all);

    if (!groups.length) {
      // Board grouping drops tasks from ordinary notes; say so rather than
      // leave an empty list with no visible cause.
      const empty = this.plugin.index.loading
        ? "Loading tasks…"
        : this.search
        ? "No matches"
        : grouping === "board" && rows.length
          ? "These tasks aren't on a Kanban board. Change Group by to see them."
          : grouping === "board"
            ? "No Kanban cards"
            : "No tasks";
      this.bodyEl.createDiv({ cls: "ps-empty", text: empty });
      return;
    }
    const items: Array<{ label: string } | TaskRow> = [];
    for (const group of groups) {
      if (group.label) items.push({ label: `${group.label} · ${group.rows.length}` });
      items.push(...group.rows);
    }
    this.renderIncrementally(items.length, (i) => {
      const item = items[i];
      if ("label" in item) {
        this.bodyEl.createDiv({ cls: "ps-group-label", text: item.label });
        return;
      }
      const { note, task } = item;
      const row = this.bodyEl.createDiv("ps-task");
      const key = `${note.path}\u0000${task.line}`;
      this.taskRowEls.set(key, row);
      const active = this.plugin.activeTask;
      if (active && active.path === note.path && active.line === task.line) {
        row.addClass("is-active");
        this.activeTaskEl = row;
      }
      const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      box.checked = isClosed(task);
      box.addEventListener("click", (evt) => evt.stopPropagation());
      box.addEventListener("change", async () => {
        // On success the index update re-renders the row. When nothing was
        // written (stale line, or Tasks declined), put the box back.
        const written = await toggleTask(this.app, note.path, task);
        if (!written) box.checked = isClosed(task);
      });

      const details = taskDetails(task.text);
      const closed = isClosed(task);
      const body = row.createDiv("ps-task-body");
      body.createDiv({ cls: "ps-task-text", text: details.description || task.text });
      const meta = body.createDiv("ps-task-meta");
      const noteLink = meta.createSpan({
        cls: "ps-task-note",
        text: note.title,
        attr: { "aria-label": `Show only tasks in ${note.title}` },
      });
      noteLink.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.filterTasksTo(note.path);
      });
      // Details as badges: priority, dates (relative), recurrence, tags.
      const badge = (icon: string | null, text: string, label: string | null, cls = "") => {
        const el = meta.createSpan({ cls: `ps-badge ${cls}`.trim() });
        if (label) el.setAttr("aria-label", label);
        if (icon) setIcon(el.createSpan("ps-badge-icon"), icon);
        el.createSpan({ text });
        return el;
      };
      const priority = PRIORITIES.find((p) => p.value === details.priority);
      if (priority) badge("flag", priority.label, `${priority.label} priority`, `is-priority-${priority.value}`);
      const due = details.due ?? task.due;
      if (due && !closed) {
        const el = badge("calendar", dueDateLabel(due, today), `Due ${due}`);
        el.toggleClass("is-overdue", due < today);
        el.toggleClass("is-today", due === today);
      }
      if (details.scheduled && !closed) {
        const el = badge("calendar-clock", dueDateLabel(details.scheduled, today), `Scheduled ${details.scheduled}`);
        el.toggleClass("is-today", details.scheduled === today);
      }
      // A start date matters only until it's reached.
      if (details.start && !closed && details.start > today) {
        badge("calendar-plus", dueDateLabel(details.start, today), `Starts ${details.start}`);
      }
      if (details.recurrence) badge("repeat", details.recurrence, `Repeats ${details.recurrence}`);
      const done = details.done ?? task.done;
      if (closed && done) badge("check", dueDateLabel(done, today), `Done ${done}`, "is-quiet");
      if (details.cancelled) badge("x", dueDateLabel(details.cancelled, today), `Cancelled ${details.cancelled}`, "is-quiet");
      for (const tag of details.badgeTags) badge(null, `#${tag}`, null, "ps-badge-tag");

      row.addEventListener("click", (evt) => void this.openTask(note.path, task.line, evt));
      this.previewOnHover(row, note.path, task.line);
    });
  }
}
