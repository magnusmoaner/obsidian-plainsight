import { Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  Editor,
  MarkdownPostProcessorContext,
  Menu,
  Notice,
  Plugin,
  WorkspaceLeaf,
} from "obsidian";
import { CALLOUT_TYPES, calloutMenu } from "./editor/callout";
import { enclosingCallout } from "./editor/syntax";
import {
  setHeading,
  toggleCode,
  toggleEm,
  toggleStrong,
} from "./editor/commands";
import { wysiwyg } from "./editor/extension";
import { treeOf } from "./editor/parser";
import { NoteIndex } from "./sidebar/core/note-index";
import { cursorTracker } from "./sidebar/cursor";
import { Indexer } from "./sidebar/indexer";
import { SIDEBAR_VIEW, SidebarView } from "./sidebar/view";
import { readBookmarks, removeBookmark } from "./sidebar/internals";
import {
  DEFAULT_SETTINGS,
  WysiwygSettings,
  WysiwygSettingTab,
} from "./settings";

/** vault.getConfig/setConfig are undocumented but long-stable, the same
 * category as the `editor.cm` handle this plugin already relies on. */
type ConfigVault = {
  getConfig?(key: string): unknown;
  setConfig?(key: string, value: unknown): void;
};

export default class WysiwygPlugin extends Plugin {
  settings!: WysiwygSettings;
  private extensions: Extension[] = [];
  /** Live Preview setting as we found it, restored when we hand control back. */
  private savedLivePreview: boolean | null = null;
  readonly index = new NoteIndex();
  indexer!: Indexer;
  /** Where the cursor last was in a note, for highlighting its task. */
  lastCursor: { path: string; line: number } | null = null;
  /** The sidebar setting as last acted on; null until loaded. */
  private sidebarApplied: boolean | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.sidebarApplied = this.settings.sidebar;
    this.refreshExtensions();
    this.applyRenderingMode();
    this.registerEditorExtension(this.extensions);
    this.addSettingTab(new WysiwygSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-wysiwyg",
      name: "Toggle WYSIWYG editing",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
      },
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
    this.app.workspace.onLayoutReady(async () => {
      // Listen first, then build: build() re-reads if anything changed meanwhile.
      this.indexer.start((ref) => this.registerEvent(ref));
      await this.indexer.build();
      if (this.settings.sidebar) await this.openSidebar();
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshExtensions();
    this.applyRenderingMode();
    this.applySidebarSetting();
  }

  private onCursor(path: string, line: number): void {
    const last = this.lastCursor;
    if (last && last.path === path && last.line === line) return;
    this.lastCursor = { path, line };
    for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)) {
      if (leaf.view instanceof SidebarView) leaf.view.markActiveTask();
    }
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

  /** Act only when the sidebar setting itself changed: re-opening on every
   * save would re-expand a collapsed sidebar and steal focus. */
  private applySidebarSetting(): void {
    if (this.settings.sidebar === this.sidebarApplied) return;
    this.sidebarApplied = this.settings.sidebar;
    if (!this.settings.sidebar) this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW);
    else if (this.app.workspace.layoutReady) void this.openSidebar();
  }

  onunload(): void {
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
    // under the cursor whenever the sidebar is on.
    if (this.settings.sidebar) {
      this.extensions.push(cursorTracker((path, line) => this.onCursor(path, line)));
    }
    if (this.settings.enabled) {
      this.extensions.push(
        wysiwyg(),
        calloutMenu.of(openCalloutMenu),
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
