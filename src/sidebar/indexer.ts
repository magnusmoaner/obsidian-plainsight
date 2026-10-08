import { App, EventRef, getAllTags, TAbstractFile, TFile, TFolder } from "obsidian";
import { NoteIndex } from "./core/note-index";
import { FileFacts, summarize, summarizeCanvas } from "./core/summary";
import { NoteSummary } from "./core/types";

/** Files the index holds: notes (incl. Kanban boards) and canvases. */
const indexed = (file: TFile) => file.extension === "md" || file.extension === "canvas";

/** Keeps a NoteIndex in step with the vault. */
export class Indexer {
  /** Set by any vault event; tells build() its snapshot may be out of date. */
  private dirty = false;

  constructor(private app: App, private index: NoteIndex) {}

  /**
   * Full rebuild. Call after start(): events that land while files are being
   * read would be overwritten by the older snapshot, so if any arrive we read
   * again (cachedRead makes the repeat cheap). Bounded so a vault that never
   * stops changing can't spin forever; the live events still apply after.
   */
  async build(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.dirty = false;
      const files = this.app.vault.getFiles().filter(indexed);
      const summaries = await Promise.all(files.map((f) => this.summarizeFile(f).catch(() => null)));
      this.index.replaceAll(summaries.filter((s): s is NoteSummary => s !== null));
      if (!this.dirty) return;
    }
  }

  /** Call once, inside onLayoutReady, before build(). */
  start(register: (ref: EventRef) => void): void {
    const { vault, metadataCache } = this.app;
    const mark = () => (this.dirty = true);
    for (const name of ["create", "delete", "rename", "modify"] as const) {
      register(vault.on(name as "create", mark));
    }
    register(metadataCache.on("changed", mark));
    // 'changed' carries the new text, so no extra read is needed. On first
    // launch, notes indexed before their metadata existed get their tags here.
    register(
      metadataCache.on("changed", (file, data) => {
        if (file.extension === "md") this.index.set(this.fromText(file, data));
      })
    );
    register(vault.on("create", (file) => void this.upsert(file)));
    // Canvases get no metadataCache "changed" event; follow their edits here.
    register(
      vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "canvas") void this.upsert(file);
      })
    );
    register(
      vault.on("delete", (file) => {
        if (file instanceof TFile) this.index.delete(file.path);
        else if (file instanceof TFolder) this.index.deleteUnder(file.path);
      })
    );
    register(
      vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.index.delete(oldPath);
          void this.upsert(file);
        } else if (file instanceof TFolder) {
          this.index.deleteUnder(oldPath);
          for (const f of this.app.vault.getFiles()) {
            if (indexed(f) && f.path.startsWith(`${file.path}/`)) void this.upsert(f);
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
