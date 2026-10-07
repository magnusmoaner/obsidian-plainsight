import { App, EventRef, getAllTags, TAbstractFile, TFile, TFolder } from "obsidian";
import { NoteIndex } from "./core/note-index";
import { summarize } from "./core/summary";
import { NoteSummary } from "./core/types";

/** Keeps a NoteIndex in step with the vault. */
export class Indexer {
  constructor(private app: App, private index: NoteIndex) {}

  async build(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    this.index.replaceAll(await Promise.all(files.map((f) => this.summarizeFile(f))));
  }

  /** Call once, inside onLayoutReady, after build(). */
  start(register: (ref: EventRef) => void): void {
    const { vault, metadataCache } = this.app;
    // 'changed' carries the new text, so no extra read is needed. On first
    // launch, notes indexed before their metadata existed get their tags here.
    register(
      metadataCache.on("changed", (file, data) => {
        if (file.extension === "md") this.index.set(this.fromText(file, data));
      })
    );
    register(vault.on("create", (file) => void this.upsert(file)));
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
          for (const f of this.app.vault.getMarkdownFiles()) {
            if (f.path.startsWith(`${file.path}/`)) void this.upsert(f);
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
    if (file instanceof TFile && file.extension === "md") {
      this.index.set(await this.summarizeFile(file));
    }
  }

  private async summarizeFile(file: TFile): Promise<NoteSummary> {
    return this.fromText(file, await this.app.vault.cachedRead(file));
  }

  private fromText(file: TFile, text: string): NoteSummary {
    const cache = this.app.metadataCache.getFileCache(file);
    const parent = file.parent;
    return summarize(
      {
        path: file.path,
        basename: file.basename,
        folder: !parent || parent.isRoot() ? "" : parent.path,
        mtime: file.stat.mtime,
        ctime: file.stat.ctime,
        tags: cache ? getAllTags(cache) ?? [] : [],
        frontmatter: cache?.frontmatter,
      },
      text
    );
  }
}
