import { App, FileView, PaneType, TFile, WorkspaceLeaf } from "obsidian";
import { hasCommand, KANBAN_NEW_BOARD } from "../sidebar/internals";
import { BoardView } from "./view";

export const BOARD_VIEW = "plainsight-board";

/**
 * Whether boards open on Plainsight's own page (the "Show boards" setting),
 * and whether the Kanban plugin's boards count as boards (its own setting).
 */
export const boardPages = { enabled: true, kanban: true };

/**
 * Whether Plainsight's page shows a note with this frontmatter: its own
 * boards always; the Kanban plugin's only while that plugin isn't there to
 * show them itself.
 */
export function ownsBoard(app: App, frontmatter: Record<string, unknown> | undefined): boolean {
  if (!boardPages.enabled) return false;
  if (frontmatter?.["plainsight-plugin"] !== undefined) return true;
  return boardPages.kanban && frontmatter?.["kanban-plugin"] !== undefined && !hasCommand(app, KANBAN_NEW_BOARD);
}

export function openBoardPage(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
  return leaf.setViewState({ type: BOARD_VIEW, state: { file: file.path }, active: true });
}

/** Panes where "Open as Markdown" asked for a board's text, by the board's path. */
export const keptAsMarkdown = new WeakMap<WorkspaceLeaf, string>();

/** A board on its own page. */
export class BoardPage extends FileView {
  private board: BoardView | null = null;

  // Not "open": that is View's own method, which Obsidian calls with the pane.
  constructor(leaf: WorkspaceLeaf, private openBoard: (file: TFile, newLeaf: PaneType | boolean) => void) {
    super(leaf);
    this.addAction("file-text", "Open as Markdown", () => {
      if (this.file) this.asMarkdown(this.file, true);
    });
  }

  getViewType(): string {
    return BOARD_VIEW;
  }

  getIcon(): string {
    return "kanban";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "md";
  }

  private asMarkdown(file: TFile, keep: boolean): void {
    if (keep) keptAsMarkdown.set(this.leaf, file.path);
    void this.leaf.setViewState({ type: "markdown", state: { file: file.path }, active: true });
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    // Obsidian keeps a pane's view for any file it accepts, so a note or a
    // Kanban board opened in this pane lands here: hand it on to the view
    // that should show it (the Kanban plugin takes its boards from there).
    // A file too new to have been read yet is one we just made: keep it.
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache && !ownsBoard(this.app, cache.frontmatter)) {
      window.setTimeout(() => this.asMarkdown(file, false));
      return;
    }
    this.contentEl.addClass("psb-page");
    this.board = this.addChild(new BoardView(this.app, this.contentEl.createDiv(), file, file.path, this.openBoard));
  }

  async onUnloadFile(): Promise<void> {
    if (this.board) this.removeChild(this.board);
    this.board = null;
  }
}
