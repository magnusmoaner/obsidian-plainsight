import { NoteIndex } from "./note-index";
import { NoteSummary } from "./types";

/** Files read per step of the initial fill; the UI gets a turn between steps. */
export const FILL_BATCH = 100;

export interface FillSource<F> {
  /** Files to read, in the order to read them. */
  files: F[];
  read(file: F): Promise<NoteSummary | null>;
  /** Whether a path is still a file in the vault once its summary is ready. */
  exists(path: string): boolean;
  /** Paths that live events have written or removed since the fill began. */
  touched: ReadonlySet<string>;
  /** Yield to the UI between batches. */
  pause(): Promise<void>;
  /** True once the plugin is unloading. */
  stopped(): boolean;
}

/**
 * The initial fill: read every file in batches and add each batch with one
 * notification, so the sidebar fills in as it goes instead of waiting for
 * the whole vault. A summary is dropped if its file has gone, or if a live
 * event wrote or removed that path after the fill began: the event's entry
 * is newer than anything this fill read, so a slow read never overwrites
 * a change that happened meanwhile.
 */
export async function fillIndex<F>(index: NoteIndex, source: FillSource<F>, batch = FILL_BATCH): Promise<void> {
  index.beginLoading(source.files.length);
  try {
    for (let start = 0; start < source.files.length; start += batch) {
      if (source.stopped()) return;
      const files = source.files.slice(start, start + batch);
      const read = await Promise.all(files.map((file) => source.read(file).catch(() => null)));
      const fresh = read.filter(
        (s): s is NoteSummary => s !== null && !source.touched.has(s.path) && source.exists(s.path)
      );
      index.setMany(fresh, start + files.length);
      await source.pause();
    }
  } finally {
    index.endLoading();
  }
}
