import { App, Editor, MarkdownPostProcessorContext, Notice, Plugin, TFile } from "obsidian";
import { addTagToNote, createBoard, openFile } from "../sidebar/actions";
import { addListItem } from "../sidebar/core/edits";
import { NoteIndex } from "../sidebar/core/note-index";
import { CodeModal, NotePickerModal, TagModal } from "../sidebar/modals";
import { appendEmbed, embedBlock, embedTarget, embedView, isBoardFrontmatter, replaceBlock, retargetEmbeds, setEmbedView } from "./board";
import { BOARD_VIEW, BoardPage, keptAsMarkdown, openBoardPage, ownsBoard } from "./page";
import { BoardHost, BoardView } from "./view";
import type { Unit } from "./timeline";

/** The board property that names the notes embedding it; the embed block names the board. */
const EMBEDDED_IN = "embedded-in";

const isBoard = (app: App, file: TFile) => isBoardFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter);

/**
 * The other half of an embed: the board names the note. Written as one new
 * line; a property in a shape that can't take one is left alone.
 */
export const linkBack = (app: App, board: TFile, note: TFile): Promise<string> =>
  app.vault.process(board, (text) => addListItem(text, EMBEDDED_IN, `"[[${app.metadataCache.fileToLinktext(note, board.path)}]]"`) ?? text);

/** Boards in notes and on their own page: the views, the commands, and keeping the two-way link. */
export function registerBoards(plugin: Plugin, boardsOn: () => boolean, template: () => string, index: NoteIndex): void {
  const { app } = plugin;
  const open = (file: TFile, newLeaf: Parameters<typeof openFile>[2]) => void openFile(app, file, newLeaf);

  const host: BoardHost = {
    // From the notes themselves, so it's true whoever wrote the embed block.
    // shortcut: the index knows a note's first embed block only, widen it if notes with several boards matter.
    embeddedIn: (board) =>
      index
        .all()
        .filter((n) => n.embeddedBoard && app.metadataCache.getFirstLinkpathDest(n.embeddedBoard, n.path)?.path === board.path)
        .map((n) => app.vault.getAbstractFileByPath(n.path))
        .filter((f): f is TFile => f instanceof TFile),
    addTag: (board) => {
      const existing = [...new Set(index.all().flatMap((n) => n.tags))];
      new TagModal(app, board.basename, existing, (tag) => {
        void addTagToNote(app, board, tag).then((added) => {
          if (added) return;
          new Notice(
            `"${board.basename}" has a tags property Plainsight won't edit automatically ` +
              "(comments or a multi-line list). Add the tag with Open as Markdown instead.",
            8000
          );
        });
      }).open();
    },
    embedIn: (board) => {
      // Any note but a board; the block goes after everything in it.
      new NotePickerModal(app, "Note to embed the board in", (note) => {
        const link = app.metadataCache.fileToLinktext(board, note.path);
        void app.vault
          .process(note, (text) => appendEmbed(text, link))
          .then(() => linkBack(app, board, note))
          .then(() => new Notice(`Embedded at the end of “${note.basename}”.`))
          .catch((err: Error) => new Notice(`Couldn't embed the board: ${err.message}`));
      }).open();
    },
    onChange: (listener) => index.subscribe(listener),
  };

  plugin.registerView(BOARD_VIEW, (leaf) => new BoardPage(leaf, open, host));

  const draw = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const target = embedTarget(source);
    if (!boardsOn()) el.createEl("pre", { text: source });
    else if (!target) el.createDiv({ cls: "psb-missing", text: "Name the board to show, like this: board: [[Board name]]" });
    else ctx.addChild(new BoardView(app, el, target, ctx.sourcePath, open, undefined, embedCode(source, el, ctx), embedView(source), embedSaveView(source, el, ctx)));
  };
  // The view picked under View, written into the block so the note opens that way next time.
  const embedSaveView = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const note = app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(note instanceof TFile)) return undefined;
    return (zoom: Unit | null) => {
      const at = ctx.getSectionInfo(el);
      const next = setEmbedView(source, zoom ? (`${zoom}s` as const) : null);
      if (!at || next === source) return;
      void app.vault.process(note, (t) => replaceBlock(t, at, source, next)).catch((err: Error) => new Notice(`Couldn't save the view in the note: ${err.message}`));
    };
  };
  // The embed block's text, saved back over the block in the note.
  const embedCode = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const note = app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(note instanceof TFile)) return undefined;
    return () =>
      new CodeModal(app, "Embed code", source, async (next) => {
        // Read now: lines above the block may have changed since it was drawn.
        const at = ctx.getSectionInfo(el);
        if (!at) throw new Error("the block is no longer in the note");
        await app.vault.process(note, (t) => replaceBlock(t, at, source, next));
      }).open();
  };
  plugin.registerMarkdownCodeBlockProcessor("plainsight-board", draw);
  // Kanban Embed draws its own blocks while it's on; a second processor for
  // the same block would break it.
  // shortcut: decided when Plainsight loads; reload Plainsight after turning Kanban Embed on or off.
  const enabled = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins?.enabledPlugins;
  if (!enabled?.has("kanban-embed")) plugin.registerMarkdownCodeBlockProcessor("kanban-embed", draw);

  const insert = async (editor: Editor, note: TFile, board: TFile, view: "board" | "timeline" = "board") => {
    const cursor = editor.getCursor();
    const prefix = editor.getLine(cursor.line).trim() ? "\n" : "";
    editor.replaceSelection(prefix + embedBlock(app.metadataCache.fileToLinktext(board, note.path), view));
    await linkBack(app, board, note);
  };
  const failed = (err: Error) => new Notice(`Couldn't insert the board: ${err.message}`);

  plugin.addCommand({
    id: "insert-new-board",
    name: "Insert new board",
    editorCheckCallback: (checking, editor, ctx) => {
      const note = ctx.file;
      if (!note || !boardsOn()) return false;
      if (!checking) {
        void createBoard(app, note.parent?.path ?? "", template(), `${note.basename} board`)
          .then((board) => insert(editor, note, board))
          .catch(failed);
      }
      return true;
    },
  });

  plugin.addCommand({
    id: "embed-board",
    name: "Embed existing board",
    editorCheckCallback: (checking, editor, ctx) => {
      const note = ctx.file;
      if (!note || !boardsOn()) return false;
      if (!checking) new BoardPicker(app, "Board to embed", (board) => void insert(editor, note, board).catch(failed)).open();
      return true;
    },
  });

  plugin.addCommand({
    id: "embed-board-timeline",
    name: "Embed existing board as a timeline",
    editorCheckCallback: (checking, editor, ctx) => {
      const note = ctx.file;
      if (!note || !boardsOn()) return false;
      if (!checking) new BoardPicker(app, "Board to embed as a timeline", (board) => void insert(editor, note, board, "timeline").catch(failed)).open();
      return true;
    },
  });

  plugin.addCommand({
    id: "open-as-board",
    name: "Open this note as a board",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      const leaf = app.workspace.getMostRecentLeaf();
      const owns = !!file && ownsBoard(app, app.metadataCache.getFileCache(file)?.frontmatter);
      if (!file || !leaf || !owns || leaf.view.getViewType() === BOARD_VIEW) return false;
      if (!checking) void openBoardPage(leaf, file);
      return true;
    },
  });

  // A Plainsight board opened as a note (from the file explorer, a link, a
  // search result) shows as a board, unless "Open as Markdown" asked for its text.
  const showAsBoard = () => {
    const leaf = app.workspace.getMostRecentLeaf();
    const file = (leaf?.view as { file?: TFile | null } | undefined)?.file;
    if (!leaf || !file || leaf.view.getViewType() !== "markdown" || keptAsMarkdown.get(leaf) === file.path) return;
    if (ownsBoard(app, app.metadataCache.getFileCache(file)?.frontmatter)) void openBoardPage(leaf, file);
  };
  plugin.registerEvent(app.workspace.on("file-open", showAsBoard));
  // A pane that held a Kanban board becomes a Markdown pane a moment after the file opens.
  plugin.registerEvent(app.workspace.on("layout-change", showAsBoard));

  // Obsidian updates links in prose and properties when a file is renamed,
  // but not inside code blocks: fix the embed blocks of the notes the board names.
  plugin.registerEvent(
    app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const named = [app.metadataCache.getFileCache(file)?.frontmatter?.[EMBEDDED_IN]].flat();
      for (const link of named) {
        if (typeof link !== "string") continue;
        const note = app.metadataCache.getFirstLinkpathDest(link.replace(/^\[\[|(\|[^\]]*)?\]\]$/g, ""), file.path);
        if (note) void app.vault.process(note, (text) => retargetEmbeds(text, oldPath, app.metadataCache.fileToLinktext(file, note.path)));
      }
    })
  );
}

class BoardPicker extends NotePickerModal {
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => isBoard(this.app, f));
  }
}
