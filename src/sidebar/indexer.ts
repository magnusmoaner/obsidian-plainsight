import { App, EventRef, getAllTags, TAbstractFile, TFile, TFolder } from "obsidian";
import { fillIndex } from "./core/fill";
import { NoteIndex } from "./core/note-index";
import { FileFacts, summarize, summarizeCanvas } from "./core/summary";
import { NoteSummary } from "./core/types";

/** Files the index holds: notes (incl. Kanban boards) and canvases. */
const indexed = (file: TFile) => file.extension === "md" || file.extension === "canvas";

/** Keeps a NoteIndex in step with the vault. */
export class Indexer {
  /** Paths live events wrote or removed while the fill was running; the
   * fill leaves these alone. Empty once it's done. */
  private touched = new Set<string>();
  private filling = false;
  private stopped = false;

  constructor(private app: App, private index: NoteIndex) {}

  /**
   * The initial fill. Call once, after start(). Reads the vault in batches,
   * most recently modified first, so the top of the notes list is right
   * within the first batch and the rest fills in below it.
   */
  async build(): Promise<void> {
    const files = this.app.vault
      .getFiles()
      .filter(indexed)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    this.filling = true;
    try {
      await fillIndex(this.index, {
        files,
        read: (file) => this.summarizeFile(file),
        exists: (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
        touched: this.touched,
        pause: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
        stopped: () => this.stopped,
      });
    } finally {
      this.filling = false;
      this.touched.clear();
    }
  }

  /** Stop the fill (the plugin is unloading). */
  stop(): void {
    this.stopped = true;
  }

  /** Call once, inside onLayoutReady, before build(). */
  start(register: (ref: EventRef) => void): void {
    const { vault, metadataCache } = this.app;
    const touch = (path: string) => {
      if (this.filling) this.touched.add(path);
    };
    // 'changed' carries the new text, so no extra read is needed. Obsidian
    // loads its metadata cache before layout-ready, so the fill sees every
    // unchanged note's tags; a note changed while Obsidian was closed is
    // re-parsed after startup and arrives here with its new metadata.
    register(
      metadataCache.on("changed", (file, data) => {
        if (file.extension !== "md") return;
        touch(file.path);
        this.index.set(this.fromText(file, data));
      })
    );
    register(
      vault.on("create", (file) => {
        touch(file.path);
        void this.upsert(file);
      })
    );
    // Canvases get no metadataCache "changed" event; follow their edits here.
    register(
      vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "canvas") return;
        touch(file.path);
        void this.upsert(file);
      })
    );
    register(
      vault.on("delete", (file) => {
        touch(file.path);
        if (file instanceof TFile) this.index.delete(file.path);
        else if (file instanceof TFolder) this.index.deleteUnder(file.path);
      })
    );
    register(
      vault.on("rename", (file, oldPath) => {
        touch(oldPath);
        touch(file.path);
        if (file instanceof TFile) {
          this.index.delete(oldPath);
          void this.upsert(file);
        } else if (file instanceof TFolder) {
          this.index.deleteUnder(oldPath);
          for (const f of this.app.vault.getFiles()) {
            if (indexed(f) && f.path.startsWith(`${file.path}/`)) {
              touch(f.path);
              void this.upsert(f);
            }
          }
        }
      })
    );
  }

  /** Every folder path in the vault, the root excluded. */
  folders(): string[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
      .map((f) => f.path);
  }

  private async upsert(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || !indexed(file)) return;
    try {
      this.index.set(await this.summarizeFile(file));
    } catch {
      // Deleted or renamed again before the read finished; that event wins.
    }
  }

  private async summarizeFile(file: TFile): Promise<NoteSummary> {
    return this.fromText(file, await this.app.vault.cachedRead(file));
  }

  private fromText(file: TFile, text: string): NoteSummary {
    const cache = this.app.metadataCache.getFileCache(file);
    const parent = file.parent;
    const facts: FileFacts = {
      path: file.path,
      basename: file.basename,
      folder: !parent || parent.isRoot() ? "" : parent.path,
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
      tags: cache ? getAllTags(cache) ?? [] : [],
      frontmatter: cache?.frontmatter,
    };
    return file.extension === "canvas" ? summarizeCanvas(facts, text) : summarize(facts, text);
  }
}
