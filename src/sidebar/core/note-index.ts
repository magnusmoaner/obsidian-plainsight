import { inFolder, NoteSummary } from "./types";

/** All note summaries, keyed by path, with change notification. */
export class NoteIndex {
  private notes = new Map<string, NoteSummary>();
  private listeners = new Set<() => void>();

  get size(): number {
    return this.notes.size;
  }

  get(path: string): NoteSummary | undefined {
    return this.notes.get(path);
  }

  all(): NoteSummary[] {
    return [...this.notes.values()];
  }

  set(summary: NoteSummary): void {
    this.notes.set(summary.path, summary);
    this.emit();
  }

  delete(path: string): void {
    if (this.notes.delete(path)) this.emit();
  }

  /** Remove every note at or beneath `folder` (a deleted or renamed folder). */
  deleteUnder(folder: string): void {
    let changed = false;
    for (const summary of [...this.notes.values()]) {
      if (inFolder(summary.folder, folder)) changed = this.notes.delete(summary.path) || changed;
    }
    if (changed) this.emit();
  }

  replaceAll(summaries: NoteSummary[]): void {
    this.notes = new Map(summaries.map((s) => [s.path, s]));
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
