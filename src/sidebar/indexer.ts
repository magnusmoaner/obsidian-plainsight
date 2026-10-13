import { App, EventRef, getAllTags, TAbstractFile, TFile, TFolder } from "obsidian";
import { fillIndex } from "./core/fill";
import { NoteIndex } from "./core/note-index";
import { FileFacts, summarize, summarizeCanvas } from "./core/summary";
import { NoteSummary } from "./core/types";

/** Files the index holds: notes (incl. Kanban boards) and canvases. */
const indexed = (file: TFile) => file.extension === "md" || file.extension === "canvas";

/** Keeps a NoteIndex in step with the vault. */
export class Indexer {
  /** Paths live events wrote or removed while a fill was running; a fill
   * leaves these alone. Empty whenever no fill runs. */
  private touched = new Set<string>();
  /** Fills running now: the initial one, or a metadata catch-up. */
  private fills = 0;
  /** Notes summarized before Obsidian had metadata for them, so without
   * their tags and properties; summarized again once it has. */
  private awaitingMetadata = new Set<string>();
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
    await this.fill(files);
    await this.catchUpMetadata();
  }

  /** Stop any fill (the plugin is unloading). */
  stop(): void {
    this.stopped = true;
  }

  private async fill(files: TFile[]): Promise<void> {
    this.fills++;
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
      if (--this.fills === 0) this.touched.clear();
    }
  }

  /**
   * Summarize again, in batches, the notes read before Obsidian had their
   * metadata. Runs when the initial fill ends and on 'resolved'; never
   * alongside another fill, whose older reads could undo it.
   */
  private async catchUpMetadata(): Promise<void> {
    if (this.fills > 0) return;
    const ready: TFile[] = [];
    for (const path of [...this.awaitingMetadata]) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) this.awaitingMetadata.delete(path);
      else if (this.app.metadataCache.getFileCache(file)) ready.push(file);
    }
    if (ready.length) await this.fill(ready);
  }

  /** Call once, inside onLayoutReady, before build(). */
  start(register: (ref: EventRef) => void): void {
    const { vault, metadataCache } = this.app;
    const touch = (path: string) => {
      if (this.fills > 0) this.touched.add(path);
    };
    // 'changed' carries the new text, so no extra read is needed.
    register(
      metadataCache.on("changed", (file, data) => {
        if (file.extension !== "md") return;
        touch(file.path);
        this.index.set(this.fromText(file, data));
      })
    );
    // Obsidian loads its metadata cache in the background at startup: a note
    // read before its metadata was there has no tags or properties, and an
    // unchanged note gets no 'changed' event to fix that. 'resolved' fires
    // once the cache is complete (and again after later changes).
    register(metadataCache.on("resolved", () => void this.catchUpMetadata()));
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
    if (file.extension === "md") {
      if (cache) this.awaitingMetadata.delete(file.path);
      else this.awaitingMetadata.add(file.path);
    }
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
