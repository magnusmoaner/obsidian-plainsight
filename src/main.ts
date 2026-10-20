import { Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  Editor,
  editorInfoField,
  MarkdownPostProcessorContext,
  Menu,
  normalizePath,
  Notice,
  Plugin,
  WorkspaceLeaf,
} from "obsidian";
import { CALLOUT_TYPES, calloutMenu } from "./editor/callout";
import { linkOpener, linkResolver } from "./editor/link-facets";
import type { LinkInfo } from "./editor/links";
import { enclosingCallout } from "./editor/syntax";
import {
  setHeading,
  toggleCode,
  toggleEm,
  toggleStrong,
} from "./editor/commands";
import { wysiwyg } from "./editor/extension";
import { treeOf } from "./editor/parser";
import { parseSettings, serializeSettings } from "./settings-data";
import { NoteIndex } from "./sidebar/core/note-index";
import { legacyViewState } from "./sidebar/core/view-state";
import { cursorTracker } from "./sidebar/cursor";
import { Indexer } from "./sidebar/indexer";
import { SIDEBAR_VIEW, SidebarView } from "./sidebar/view";
import { readBookmarks, removeBookmark } from "./sidebar/internals";
import { ViewStateStore } from "./sidebar/view-state-store";
import {
  DEFAULT_SETTINGS,
  WysiwygSettings,
  WysiwygSettingTab,
} from "./settings";

/**
 * URL schemes a Cmd+click may hand to the system. Not obsidian:// — plugins
 * register their own obsidian:// actions, so an allowlisted scheme would
 * still let a crafted link in a note trigger arbitrary plugin behaviour.
 */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** How long after startup a missing data.json may still be on its way from a
 * sync service, so a change made meanwhile waits rather than replace it. */
const SETTINGS_GRACE_MS = 60_000;

/** vault.getConfig/setConfig are undocumented but long-stable, the same
 * category as the `editor.cm` handle this plugin already relies on. */
type ConfigVault = {
  getConfig?(key: string): unknown;
  setConfig?(key: string, value: unknown): void;
};

export default class WysiwygPlugin extends Plugin {
  settings: WysiwygSettings = { ...DEFAULT_SETTINGS };
  /** The sidebar's per-device state: folds, column width, grouping. */
  viewState!: ViewStateStore;
  /** Keys in data.json this version doesn't know, written back unchanged. */
  private settingsExtra: Record<string, unknown> = {};
  /**
   * data.json as last read: "file" (read fine), "none" (no file yet: a fresh
   * install, or a sync service that hasn't delivered it) or "unreadable"
   * (there, but not valid JSON, typically mid-way through a sync).
   */
  private settingsSource: "file" | "none" | "unreadable" = "none";
  /** Changes not yet written, kept on top of whatever the file turns out to hold. */
  private unsavedSettings: Partial<WysiwygSettings> = {};
  private settingsLoadedAt = 0;
  private settingsRetry: number | null = null;
  private extensions: Extension[] = [];
  /** Live Preview setting as we found it, restored when we hand control back. */
  private savedLivePreview: boolean | null = null;
  readonly index = new NoteIndex();
  indexer!: Indexer;
  /** The task under the cursor in a note, if the cursor is on one. */
  activeTask: { path: string; line: number } | null = null;
  private cursorTimer: number | null = null;

  async onload(): Promise<void> {
    this.viewState = new ViewStateStore(this.app);
    await this.loadSettings();
    this.refreshExtensions();
    this.applyRenderingMode();
    this.registerEditorExtension(this.extensions);
    this.addSettingTab(new WysiwygSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-wysiwyg",
      name: "Toggle WYSIWYG editing",
      callback: () => this.updateSettings({ enabled: !this.settings.enabled }),
    });

    // Palette commands; inside the editor the CM keymap (Mod+B/I/`) already
    // handles the hotkeys at higher precedence.
    this.addCommand({
      id: "toggle-strong",
      name: "Toggle bold",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, toggleStrong),
    });
    this.addCommand({
      id: "toggle-em",
      name: "Toggle italic",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, toggleEm),
    });
    this.addCommand({
      id: "toggle-code",
      name: "Toggle inline code",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, toggleCode),
    });

    // Cmd+Opt+1..6 / Cmd+Opt+0 in the CM keymap; registered here too so they
    // show in the palette and can be rebound in Obsidian's hotkey settings.
    for (const level of [0, 1, 2, 3, 4, 5, 6]) {
      this.addCommand({
        id: level === 0 ? "set-paragraph" : `set-heading-${level}`,
        name: level === 0 ? "Set paragraph" : `Set heading ${level}`,
        editorCheckCallback: (checking, editor) =>
          this.withView(checking, editor, setHeading(level)),
      });
    }

    // Obsidian renders the callout box through the reading-mode pipeline even
    // in Live Preview, so a post-processor can reach the rendered box and put
    // the type picker where the "Edit this block" button sits. This is the
    // only way to get the control into the *rendered* state — our editor
    // widget exists solely while the source lines are exposed.
    this.registerMarkdownPostProcessor((el, ctx) => {
      for (const box of Array.from(el.querySelectorAll(".callout"))) {
        if (box.querySelector(".cm-wys-callout-menu")) continue;
        const current = box.getAttribute("data-callout") ?? "note";
        const button = box.createDiv({ cls: "cm-wys-callout-menu" });
        button.textContent = "···";
        button.setAttribute("aria-label", "Change callout type");
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openCalloutMenu(event, current, (type) => {
            this.retypeRenderedCallout(ctx, el, type);
          });
        });
      }
    });

    this.addCommand({
      id: "dump-syntax-tree",
      name: "Dump syntax tree to console (debug)",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, (cm) => {
          console.log(treeOf(cm.state).toString());
          return true;
        }),
    });

    this.addCommand({
      id: "dump-block-dom",
      name: "Copy block DOM at cursor (debug)",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, (cm) => {
          copyDump(describeBlockDom(cm));
          return true;
        }),
    });

    this.indexer = new Indexer(this.app, this.index);
    this.registerView(SIDEBAR_VIEW, (leaf: WorkspaceLeaf) => new SidebarView(leaf, this));
    // Listed in Page Preview's settings, where Cmd/Ctrl can be made required.
    this.registerHoverLinkSource(SIDEBAR_VIEW, { display: "Plainsight", defaultMod: false });
    this.addCommand({
      id: "remove-dead-bookmarks",
      name: "Remove bookmarks to deleted notes",
      callback: () => this.removeDeadBookmarks(),
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open notes sidebar",
      callback: () => void this.openSidebar(),
    });
    this.addCommand({
      id: "search-everywhere",
      name: "Search everywhere",
      callback: () => void this.openSearch(),
    });
    this.app.workspace.onLayoutReady(() => {
      // Listen first, then fill: the fill never overwrites what an event
      // wrote meanwhile. The sidebar opens at once and fills in as notes are
      // read, rather than after the whole vault has been.
      this.indexer.start((ref) => this.registerEvent(ref));
      void this.indexer.build();
      void this.openSidebar();
    });
  }

  /** Map a rendered callout back to its source line and rewrite `[!type]`.
   * getSectionInfo gives us the line range the rendered block came from, which
   * is the supported way back from rendered DOM to the document. */
  private retypeRenderedCallout(
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement,
    type: string
  ): void {
    const info = ctx.getSectionInfo(el);
    const editor = this.app.workspace.activeEditor?.editor;
    if (!info || !editor) return;
    const line = editor.getLine(info.lineStart);
    const match = /^(\s*>\s*)\[!([a-zA-Z_-]+)\]/.exec(line);
    if (!match) return;
    editor.replaceRange(
      `[!${type}]`,
      { line: info.lineStart, ch: match[1].length },
      { line: info.lineStart, ch: match[1].length + match[2].length + 3 }
    );
  }

  private withView(
    checking: boolean,
    editor: Editor,
    fn: (cm: EditorView) => boolean
  ): boolean {
    // editor.cm is Obsidian's undocumented-but-stable CM6 handle.
    const cm = (editor as Editor & { cm?: EditorView }).cm;
    if (!cm) return false;
    if (checking) return true;
    return fn(cm);
  }

  async loadSettings(): Promise<void> {
    this.settingsLoadedAt = Date.now();
    this.adoptSettings(await this.readSettingsFile());
    if (this.settingsSource === "unreadable") {
      new Notice(
        "Plainsight couldn't read its settings file, perhaps because it's still syncing. " +
          "It's using the defaults for now and leaves the file untouched."
      );
    }
  }

  /** Change settings: they apply at once, and are written to data.json as
   * soon as that's safe (see writeSettings). */
  async updateSettings(patch: Partial<WysiwygSettings>): Promise<void> {
    const before = this.settings;
    this.settings = { ...this.settings, ...patch };
    this.unsavedSettings = { ...this.unsavedSettings, ...patch };
    await this.writeSettings();
    this.applySettings(before);
  }

  /** A sync service (or another program) changed data.json. */
  async onExternalSettingsChange(): Promise<void> {
    const before = this.settings;
    this.adoptSettings(await this.readSettingsFile());
    // Changes made while the file couldn't be read can be written now.
    if (this.settingsSource === "file" && Object.keys(this.unsavedSettings).length) await this.writeSettings();
    this.applySettings(before);
  }

  /**
   * loadData() gives null when data.json doesn't exist and undefined when it
   * exists but isn't valid JSON, typically because a sync service is part-way
   * through writing it. Give that a moment to finish before concluding. An
   * iCloud placeholder (".data.json.icloud": the file exists but hasn't been
   * downloaded) counts as unreadable, not missing.
   */
  private async readSettingsFile(): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const data: unknown = await this.loadData();
      if (data === null) return (await this.settingsPlaceholder()) ? undefined : null;
      if (data !== undefined || attempt === 3) return data;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }

  private async settingsPlaceholder(): Promise<boolean> {
    const dir = this.manifest.dir;
    if (!dir) return false;
    try {
      return await this.app.vault.adapter.exists(normalizePath(`${dir}/.data.json.icloud`));
    } catch {
      return false;
    }
  }

  /** Take settings from a read of data.json, with unsaved changes on top.
   * A missing or unreadable file leaves the settings in memory as they are. */
  private adoptSettings(data: unknown): void {
    if (data === undefined) {
      this.settingsSource = "unreadable";
      return;
    }
    if (data === null) {
      this.settingsSource = "none";
      return;
    }
    const { settings, extra } = parseSettings(data);
    this.settings = { ...settings, ...this.unsavedSettings };
    this.settingsExtra = extra;
    this.settingsSource = "file";
    if (typeof data === "object") this.viewState.adopt(legacyViewState(data as Record<string, unknown>));
  }

  /**
   * Write data.json, but never over a file that may hold the real settings
   * and hasn't been read: a sync service may not have delivered it (fully)
   * yet, and writing now would replace the settings on every device. Unless
   * the last read was clean, read again first. Changes wait in memory, and
   * are retried every few seconds, while the file is unreadable, or missing
   * during the first minute after startup; a file still missing after that
   * is taken to be a fresh install.
   */
  private async writeSettings(): Promise<void> {
    if (this.settingsSource !== "file") {
      this.adoptSettings(await this.readSettingsFile());
      const mayArrive =
        this.settingsSource === "unreadable" ||
        (this.settingsSource === "none" && Date.now() - this.settingsLoadedAt < SETTINGS_GRACE_MS);
      if (mayArrive) return this.retrySettingsWrite();
    }
    await this.saveData(serializeSettings(this.settings, this.settingsExtra));
    this.unsavedSettings = {};
    this.settingsSource = "file";
  }

  private retrySettingsWrite(): void {
    if (this.settingsRetry !== null) return;
    this.settingsRetry = window.setTimeout(() => {
      this.settingsRetry = null;
      if (!Object.keys(this.unsavedSettings).length) return;
      const before = this.settings;
      void this.writeSettings().then(() => this.applySettings(before));
    }, 5000);
  }

  /** Act on what changed between two versions of the settings. */
  private applySettings(before: WysiwygSettings): void {
    const now = this.settings;
    if (
      before.enabled !== now.enabled ||
      before.takeOverRendering !== now.takeOverRendering
    ) {
      this.refreshExtensions();
      this.applyRenderingMode();
    }
    const buttons = [
      "showActionRow",
      "showNoteButton",
      "showSearchButton",
      "showNewFolderButton",
      "showNewTaskButton",
      "showMoreButton",
    ] as const;
    if (
      before.boardCardsInTasks !== now.boardCardsInTasks ||
      buttons.some((key) => before[key] !== now[key])
    ) {
      this.refreshSidebar();
    }
    const insets = ["listInsetTop", "listInsetBottom", "listInsetLeft", "listInsetRight"] as const;
    if (insets.some((key) => before[key] !== now[key])) {
      for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)) {
        if (leaf.view instanceof SidebarView) leaf.view.applyListInset();
      }
    }
  }

  /**
   * Cursor moved to another line. Wait until it settles (arrowing through a
   * note costs nothing on the way), then only touch the sidebar when the
   * highlighted task actually changes — most lines aren't tasks, and the
   * index answers that without the DOM.
   */
  private onCursor(path: string, line: number): void {
    if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = null;
      const isTask = this.index.get(path)?.tasks.some((t) => t.line === line) ?? false;
      const next = isTask ? { path, line } : null;
      const prev = this.activeTask;
      if (prev?.path === next?.path && prev?.line === next?.line) return;
      this.activeTask = next;
      for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)) {
        if (leaf.view instanceof SidebarView) leaf.view.markActiveTask();
      }
    }, 150);
  }

  onunloadCursor(): void {
    if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
  }

  /** Vault part of a link target: no "#subpath", URL-decoded for markdown links. */
  private linkPath(target: string): string {
    const path = target.split("#")[0];
    try {
      return decodeURI(path);
    } catch {
      return path;
    }
  }

  private resolvesLink(sourcePath: string, target: string): boolean {
    const path = this.linkPath(target);
    if (!path) return true; // [[#Heading]] — a heading in this note
    return this.app.metadataCache.getFirstLinkpathDest(path, sourcePath) !== null;
  }

  private openLink(sourcePath: string, link: LinkInfo, split: boolean): void {
    if (link.evernote) {
      new Notice("This Evernote link points to a note outside this vault.");
      return;
    }
    if (link.external) {
      // Only open schemes that are safe to hand to the system: imported
      // notes can contain javascript:, file: or app-specific URLs, and a
      // Cmd+click must never run or launch something unexpected.
      let url: URL;
      try {
        url = new URL(link.target);
      } catch {
        new Notice("That link isn't a valid URL.");
        return;
      }
      if (!SAFE_LINK_SCHEMES.has(url.protocol)) {
        new Notice(`Not opening a ${url.protocol} link from a note.`);
        return;
      }
      window.open(url.href, "_blank", "noopener");
      return;
    }
    // A vault link (wiki or relative markdown); an unresolved one creates the note.
    const sub = link.target.includes("#") ? link.target.slice(link.target.indexOf("#")) : "";
    void this.app.workspace.openLinkText(`${this.linkPath(link.target)}${sub}`, sourcePath, split ? "split" : false);
  }

  /** Re-render open sidebars after a setting that changes what they show. */
  refreshSidebar(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)) {
      if (leaf.view instanceof SidebarView) leaf.view.refresh();
    }
  }

  /** Remove bookmarks whose note or folder no longer exists. */
  removeDeadBookmarks(): void {
    const dead = (readBookmarks(this.app) ?? []).filter(
      (b) => b.kind !== "search" && !this.app.vault.getAbstractFileByPath(b.target)
    );
    const removed = dead.filter((b) => removeBookmark(this.app, b)).length;
    new Notice(
      dead.length === 0
        ? "No bookmarks point to deleted notes."
        : `Removed ${removed} of ${dead.length} bookmark${dead.length === 1 ? "" : "s"} to deleted notes.`
    );
  }

  async openSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
    if (!leaf) {
      const left = workspace.getLeftLeaf(false);
      if (!left) return;
      await left.setViewState({ type: SIDEBAR_VIEW, active: true });
      leaf = left;
    }
    await workspace.revealLeaf(leaf);
  }

  /** Search everywhere. It searches what the sidebar indexes, so it needs
   * the sidebar; opening the window doesn't reveal it. */
  async openSearch(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
    if (!leaf) {
      await this.openSidebar();
      leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
    }
    // Obsidian 1.7+ creates a background tab's view only when it's needed.
    await (leaf as WorkspaceLeaf & { loadIfDeferred?(): Promise<void> })?.loadIfDeferred?.();
    if (leaf?.view instanceof SidebarView) leaf.view.openSearch();
  }

  onunload(): void {
    this.indexer?.stop();
    if (this.settingsRetry !== null) window.clearTimeout(this.settingsRetry);
    this.onunloadCursor();
    this.restoreLivePreview();
  }

  /** Source mode is the only state in which we are the sole renderer: Live
   * Preview replaces whole blocks (callouts, embeds) with its own widgets and
   * offers no API to opt out per construct. */
  private applyRenderingMode(): void {
    const vault = this.app.vault as unknown as ConfigVault;
    if (!vault.getConfig || !vault.setConfig) return;

    if (this.settings.enabled && this.settings.takeOverRendering) {
      if (this.savedLivePreview === null) {
        this.savedLivePreview = vault.getConfig("livePreview") !== false;
      }
      vault.setConfig("livePreview", false);
    } else {
      this.restoreLivePreview();
    }
    this.app.workspace.updateOptions();
  }

  private restoreLivePreview(): void {
    if (this.savedLivePreview === null) return;
    const vault = this.app.vault as unknown as ConfigVault;
    vault.setConfig?.("livePreview", this.savedLivePreview);
    this.savedLivePreview = null;
  }

  private refreshExtensions(): void {
    // Mutate the registered array in place; updateOptions() makes all open
    // editors reconfigure with the new contents.
    this.extensions.length = 0;
    // Independent of WYSIWYG editing: the Tasks list highlights the task
    // under the cursor.
    this.extensions.push(cursorTracker((path, line) => this.onCursor(path, line)));
    if (this.settings.enabled) {
      this.extensions.push(
        wysiwyg(),
        calloutMenu.of(openCalloutMenu),
        linkResolver.of((state, target) => this.resolvesLink(state.field(editorInfoField, false)?.file?.path ?? "", target)),
        linkOpener.of((view, link, split) =>
          this.openLink(view.state.field(editorInfoField, false)?.file?.path ?? "", link, split)
        ),
        // Bound as a key, not just a palette command: the palette blurs the
        // editor, and the blurred state is exactly what we must not measure.
        Prec.high(
          keymap.of([
            {
              key: "Mod-Alt-d",
              run: (view) => {
                copyDump(describeBlockDom(view));
                return true;
              },
            },
          ])
        )
      );
    }
    this.app.workspace.updateOptions();
  }
}

/** Clipboard rather than console only: the console needs devtools open, which
 * is a needless hurdle for a one-shot diagnostic. */
function copyDump(dump: string): void {
  console.log(dump);
  navigator.clipboard.writeText(dump).then(
    () => new Notice(`Block DOM copied (${dump.split("\n").length} lines)`),
    () => new Notice("Copy failed — see the developer console")
  );
}

/** Injected into the editor via the calloutMenu facet so the decoration path
 * never imports `obsidian` and stays testable outside the app. */
const openCalloutMenu = (
  event: MouseEvent,
  current: string,
  choose: (type: string) => void
): void => {
  const menu = new Menu();
  for (const type of CALLOUT_TYPES) {
    menu.addItem((item) =>
      item
        .setTitle(type[0].toUpperCase() + type.slice(1))
        .setChecked(type === current)
        .onClick(() => choose(type))
    );
  }
  menu.showAtMouseEvent(event);
};

/**
 * Structure-only dump of the DOM around the cursor: element tags and classes,
 * never text. Tells us whether Obsidian renders a callout as line decorations
 * on each `.cm-line`, as a wrapper element, or as a replacing widget — which
 * decides whether our own rendering can coexist with it.
 */
function describeBlockDom(view: EditorView): string {
  const out: string[] = [];
  const state = view.state;
  const describe = (node: Node | null): string => {
    if (!node) return "(none)";
    if (node === view.contentDOM) return "div.cm-content";
    if (!(node instanceof HTMLElement)) {
      return `#${node.nodeName}<${describe(node.parentNode)}>`;
    }
    const cls = node.className
      ? `.${node.className.trim().split(/\s+/).join(".")}`
      : "";
    return `${node.tagName.toLowerCase()}${cls}`;
  };

  const head = state.selection.main.head;
  const cursorLine = state.doc.lineAt(head);
  out.push(
    `cursor ${head}, line ${cursorLine.number}/${state.doc.lines}, ` +
      `${state.doc.length} chars`
  );
  // Decisive for interpreting the rest: Obsidian re-renders blocks as widgets
  // when the editor blurs, and opening the command palette blurs it. A dump
  // taken with focus=false says nothing about the editing state.
  out.push(`editor focused: ${view.hasFocus}`);

  // The decisive question: are the callout's source lines rendered as text
  // (our decorations can apply) or swallowed by a replacing widget?
  const callout = enclosingCallout(state, head);
  out.push("=== callout at cursor (our parse tree) ===");
  if (!callout) {
    out.push("NONE — put the caret inside the box's text and re-run");
  } else {
    const first = state.doc.lineAt(callout.from).number;
    const last = state.doc.lineAt(callout.to).number;
    out.push(`[!${callout.type}] spans lines ${first}..${last}`);
    for (let n = first; n <= last; n++) {
      const at = view.domAtPos(state.doc.line(n).from);
      const el =
        at.node instanceof HTMLElement ? at.node : at.node.parentElement;
      const inLine = el?.closest(".cm-line") ? "IN .cm-line" : "NOT in .cm-line";
      out.push(`  line ${n}: ${describe(at.node)} — ${inLine}`);
    }
  }

  out.push("=== callout elements present ===");
  const found = view.contentDOM.querySelectorAll("[class*='allout']");
  out.push(`${found.length} matching elements, ${
    view.contentDOM.querySelectorAll(".cm-line").length
  } .cm-line total`);
  for (const el of Array.from(found)) {
    if (!el.className.includes("cm-")) continue; // only the editor-level wrappers
    out.push(
      `${describe(el)} [${el.querySelectorAll(".cm-line").length} .cm-line inside]`
    );
  }
  return out.join("\n");
}
