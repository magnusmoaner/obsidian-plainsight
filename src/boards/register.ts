import { App, Editor, MarkdownPostProcessorContext, Notice, Plugin, TFile } from "obsidian";
import { addTagToNote, createBoard, openFile } from "../sidebar/actions";
import { addListItem } from "../sidebar/core/edits";
import { NoteIndex } from "../sidebar/core/note-index";
import { NotePickerModal, TagModal } from "../sidebar/modals";
import { embedBlock, embedTarget, isBoardFrontmatter, retargetEmbeds } from "./board";
import { BOARD_VIEW, BoardPage, keptAsMarkdown, openBoardPage, ownsBoard } from "./page";
import { BoardHost, BoardView } from "./view";

/** The board property that names the notes embedding it; the embed block names the board. */
const EMBEDDED_IN = "embedded-in";

const isBoard = (app: App, file: TFile) => isBoardFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter);

/** Boards in notes and on their own page: the views, the commands, and keeping the two-way link. */
export function registerBoards(plugin: Plugin, boardsOn: () => boolean, index: NoteIndex): void {
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
  };

  plugin.registerView(BOARD_VIEW, (leaf) => new BoardPage(leaf, open, host));

  const draw = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const target = embedTarget(source);
    if (!boardsOn()) el.createEl("pre", { text: source });
    else if (!target) el.createDiv({ cls: "psb-missing", text: "Name the board to show, like this: board: [[Board name]]" });
    else ctx.addChild(new BoardView(app, el, target, ctx.sourcePath, open));
  };
  plugin.registerMarkdownCodeBlockProcessor("plainsight-board", draw);
  // Kanban Embed draws its own blocks while it's on; a second processor for
  // the same block would break it.
  // shortcut: decided when Plainsight loads; reload Plainsight after turning Kanban Embed on or off.
  const enabled = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins?.enabledPlugins;
  if (!enabled?.has("kanban-embed")) plugin.registerMarkdownCodeBlockProcessor("kanban-embed", draw);

  const insert = async (editor: Editor, note: TFile, board: TFile) => {
    const cursor = editor.getCursor();
    const prefix = editor.getLine(cursor.line).trim() ? "\n" : "";
    editor.replaceSelection(prefix + embedBlock(app.metadataCache.fileToLinktext(board, note.path)));
    // The other half of the link: the board names the note. Written as one
    // new line; a property in a shape that can't take one is left alone.
    const back = `"[[${app.metadataCache.fileToLinktext(note, board.path)}]]"`;
    await app.vault.process(board, (text) => addListItem(text, EMBEDDED_IN, back) ?? text);
  };
  const failed = (err: Error) => new Notice(`Couldn't insert the board: ${err.message}`);

  plugin.addCommand({
    id: "insert-new-board",
    name: "Insert new board",
    editorCheckCallback: (checking, editor, ctx) => {
      const note = ctx.file;
      if (!note || !boardsOn()) return false;
      if (!checking) {
        void createBoard(app, note.parent?.path ?? "", `${note.basename} board`)
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
