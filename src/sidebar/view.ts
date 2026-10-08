import {
  ItemView,
  Keymap,
  Menu,
  Notice,
  Platform,
  SearchComponent,
  setIcon,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
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
  visibleRows,
} from "./core/queries";
import {
  AttachmentFile,
  attachmentFolderMatcher,
  attachmentsFor,
  formatSize,
} from "./core/attachments";
import { taskDisplayText } from "./core/tasks";
import { isClosed, NoteSummary } from "./core/types";
import { addTagToNote, addTaskLine, createNote, openFile, toggleTask, togglePin } from "./actions";
import { NotebookModal, NotePickerModal, TagModal, TaskModal } from "./modals";
import {
  attachmentFolderSetting,
  Bookmark,
  bookmarksInstance,
  onBookmarksChanged,
  openGlobalSearch,
  openSettingsTab,
  readBookmarks,
  removeBookmark,
  tasksCreateModal,
  templateOptions,
} from "./internals";

export const SIDEBAR_VIEW = "plainsight-sidebar";
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
  isAttachmentFolder: (folder: string) => boolean;
}

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
  private unsubscribeBookmarks: (() => void) | null = null;
  private watchedBookmarks: unknown = null;

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
    // Obsidian's own SearchComponent: the same pill, magnifier and clear
    // button as its other search fields. Built once — re-creating it on
    // every render would steal focus mid-typing.
    new SearchComponent(list.createDiv("ps-search"))
      .setPlaceholder("Search")
      .onChange((value) => {
        this.search = value;
        this.resetScroll();
        this.renderList();
      });
    this.filtersEl = list.createDiv("ps-filters");
    this.bodyEl = list.createDiv("ps-list-body");

    this.makeResizable(divider);
    this.unsubscribe = this.plugin.index.subscribe(() => this.queueRender());
    this.watchBookmarks();
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    // The index tracks .md only; everything else (attachments, and bookmarked
    // canvases/bases) comes straight from the vault, so re-render ourselves.
    const onFile = (file: { path: string }) => {
      if (!/\.md$/i.test(file.path)) this.queueRender();
    };
    for (const name of ["create", "delete", "rename", "modify"] as const) {
      this.registerEvent(this.app.vault.on(name as "create", onFile));
    }
    this.render();
  }

  async onClose(): Promise<void> {
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
    for (const note of this.plugin.index.all()) {
      const source = note.extracted ? this.sourceFile(note) : null;
      if (!source) {
        notes.push(note);
        continue;
      }
      const list = companions.get(source.path);
      if (list) list.push(note);
      else companions.set(source.path, [note]);
    }
    return { notes, companions, isAttachmentFolder };
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

    // Evernote-style action row: the Note pill, then round icon buttons.
    const actions = nav.createDiv("ps-nav-actions");
    const newNote = actions.createDiv("ps-new-note");
    setIcon(newNote.createSpan("ps-nav-icon"), "file-plus-2");
    newNote.createSpan({ text: "Note" });
    newNote.addEventListener("click", () => void createNote(this.app, this.currentFolder()));
    this.roundButton(actions, "folder-plus", "New folder", () => this.newNotebook(isAttachmentFolder));
    this.roundButton(actions, "list-checks", "New task", () => void this.newTask());
    this.roundButton(actions, "more-horizontal", "More", (evt) =>
      this.moreMenu(evt, tagRows(notes).map((t) => t.path))
    );

    const bookmarks = readBookmarks(this.app);
    if (bookmarks && bookmarks.length && this.navHeading(nav, "Bookmarks", "bookmark", "section:bookmarks")) {
      for (const b of bookmarks) this.bookmarkRow(nav, b);
    }

    const noteCount = notesFor(notes, { kind: "notes" }, unfiltered).length;
    const openTasks = taskRows(notes, "open", localISODate(), templates).length;
    const templateCount = templates
      ? notesFor(notes, { kind: "templates" }, unfiltered).length
      : null;
    this.placeRow(nav, "Notes", "file-text", { kind: "notes" }, 0, noteCount);
    this.placeRow(nav, "Tasks", "check-circle-2", { kind: "tasks" }, 0, openTasks, () => void this.newTask());
    this.placeRow(nav, "Attachments", "paperclip", { kind: "attachments" }, 0, this.attachmentFiles().length);
    this.placeRow(nav, "Templates", "layout-template", { kind: "templates" }, 0, templateCount);

    const notebooks = folderRows(this.plugin.indexer.folders(), notes, templates, isAttachmentFolder);
    if (this.navHeading(nav, "Folders", "folder", "section:notebooks", () => this.newNotebook(isAttachmentFolder))) {
      this.treeSection(nav, notebooks, "notebook", (row) => ({ kind: "notebook", folder: row.path }));
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
  ): void {
    const button = parent.createDiv({ cls: "ps-round-button", attr: { "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  private moreMenu(evt: MouseEvent, tags: string[]): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("New tag…").setIcon("tag").onClick(() => this.newTag(tags)));
    menu.addItem((i) =>
      i
        .setTitle("Search all notes")
        .setIcon("search")
        .onClick(() => {
          if (!openGlobalSearch(this.app, "")) new Notice("The core Search plugin is turned off.");
        })
    );
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

  /** Fold or unfold every section and nested folder/tag at once. */
  private setAllCollapsed(collapsed: boolean): void {
    const settings = this.plugin.settings;
    if (collapsed) {
      const { notes, isAttachmentFolder } = this.partition();
      const templates = templateOptions(this.app).folder;
      const parents = (rows: TreeRow[], prefix: string) =>
        visibleRows(rows, new Set())
          .filter((r) => r.hasChildren)
          .map((r) => `${prefix}:${r.path}`);
      settings.sidebarCollapsed = [
        "section:bookmarks",
        "section:notebooks",
        "section:tags",
        ...parents(folderRows(this.plugin.indexer.folders(), notes, templates, isAttachmentFolder), "notebook"),
        ...parents(tagRows(notes), "tag"),
      ];
    } else {
      settings.sidebarCollapsed = [];
    }
    void this.plugin.saveData(settings);
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
    return this.plugin.settings.sidebarCollapsed.includes(key);
  }

  private toggleCollapsed(key: string): void {
    const list = this.plugin.settings.sidebarCollapsed;
    const at = list.indexOf(key);
    if (at === -1) list.push(key);
    else list.splice(at, 1);
    // saveData, not saveSettings: no need to reconfigure every editor.
    void this.plugin.saveData(this.plugin.settings);
    this.renderNav();
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
    toPlace: (row: TreeRow) => Place
  ): void {
    const collapsed = new Set(
      this.plugin.settings.sidebarCollapsed
        .filter((k) => k.startsWith(`${keyPrefix}:`))
        .map((k) => k.slice(keyPrefix.length + 1))
    );
    for (const row of visibleRows(rows, collapsed)) {
      const place = toPlace(row);
      const el = this.navRow(parent, row.name, null, row.depth + 1, row.count, this.isActive(place));
      el.addEventListener("click", () => this.setPlace(place));
      if (!row.hasChildren) continue;
      // Replace the empty icon slot with one that shows a chevron on hover.
      el.addClass("is-foldable");
      const slot = this.foldSlot(el, null, row.collapsed);
      el.querySelector(".ps-nav-icon")!.replaceWith(slot);
      slot.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.toggleCollapsed(`${keyPrefix}:${row.path}`);
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

  /** Tasks' own dialog when available; the result is appended to the task note. */
  private async newTask(): Promise<void> {
    const target = await this.taskNote();
    if (!target) return;
    const fromTasks = tasksCreateModal(this.app);
    const line = fromTasks
      ? await fromTasks
      : await new Promise<string>((resolve) => new TaskModal(this.app, resolve).open());
    if (!line.trim()) return; // cancelled
    await addTaskLine(this.app, target, line);
    new Notice(`Task added to ${target.basename}`);
  }

  /** The default task note; the first time (or if it's gone), ask and remember. */
  private taskNote(): Promise<TFile | null> {
    const current = this.app.vault.getAbstractFileByPath(this.plugin.settings.defaultTaskNote);
    // Only a Markdown note: appending a task line to a canvas, base or PDF
    // would corrupt it.
    if (current instanceof TFile && current.extension === "md") return Promise.resolve(current);
    return new Promise((resolve) => {
      new NotePickerModal(this.app, "Choose the note new tasks are added to", (file) => {
        this.plugin.settings.defaultTaskNote = file.path;
        void this.plugin.saveData(this.plugin.settings);
        new Notice(`New tasks will go to ${file.basename}. Change it in Plainsight settings.`);
        resolve(file);
      }).open();
    });
  }

  private newNotebook(isAttachmentFolder: (folder: string) => boolean): void {
    const templates = templateOptions(this.app).folder;
    const folders = this.plugin.indexer
      .folders()
      .filter((f) => !isAttachmentFolder(f) && !(templates && (f === templates || f.startsWith(`${templates}/`))))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    const parent = this.place.kind === "notebook" ? this.place.folder : "";
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
    const list = notesFor(this.partition().notes, this.place, this.queryOptions());
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
      else if ("note" in item) this.renderCard(item.note);
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

  private renderAttachments(): void {
    const { companions } = this.partition();
    const files = attachmentsFor(this.attachmentFiles(), companions, this.search, this.sort);
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
      else if ("file" in item) this.renderAttachmentCard(item.file, companions.get(item.file.path) ?? []);
    });
  }

  private renderAttachmentCard(file: AttachmentFile, companions: NoteSummary[]): void {
    const card = this.bodyEl.createDiv({ cls: "ps-card", attr: { "data-path": file.path } });
    card.toggleClass("is-active", this.app.workspace.getActiveFile()?.path === file.path);
    const text = card.createDiv("ps-card-text");
    text.createDiv({ cls: "ps-card-title", text: file.name });
    // The extracted text is the best preview of what the file says.
    const snippet = companions.find((c) => c.snippet)?.snippet;
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
    card.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      const menu = new Menu();
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
      if (companions.length) menu.addSeparator();
      this.app.workspace.trigger("file-menu", menu, tfile, "plainsight-sidebar");
      menu.showAtMouseEvent(evt);
    });
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
      this.partition().notes,
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
