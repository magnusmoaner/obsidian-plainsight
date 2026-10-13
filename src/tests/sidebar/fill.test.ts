import { describe, expect, test, vi } from "vitest";
import { fillIndex, FillSource } from "../../sidebar/core/fill";
import { NoteIndex } from "../../sidebar/core/note-index";
import { NoteSummary } from "../../sidebar/core/types";
import { note } from "./fixtures";

/** A source over plain paths; every read succeeds unless told otherwise. */
function source(paths: string[], overrides: Partial<FillSource<string>> = {}): FillSource<string> {
  return {
    files: paths,
    read: async (path) => note(path),
    exists: () => true,
    touched: new Set(),
    pause: async () => undefined,
    stopped: () => false,
    ...overrides,
  };
}

describe("fillIndex", () => {
  test("reads every file, one notification per batch, reporting progress", async () => {
    const index = new NoteIndex();
    const seen: Array<{ size: number; loading: { done: number; total: number } | null }> = [];
    index.subscribe(() => seen.push({ size: index.size, loading: index.loading }));
    await fillIndex(index, source(["a.md", "b.md", "c.md", "d.md", "e.md"]), 2);
    expect(index.size).toBe(5);
    expect(index.loading).toBeNull();
    expect(seen).toEqual([
      { size: 0, loading: { done: 0, total: 5 } },
      { size: 2, loading: { done: 2, total: 5 } },
      { size: 4, loading: { done: 4, total: 5 } },
      { size: 5, loading: { done: 5, total: 5 } },
      { size: 5, loading: null },
    ]);
  });

  test("pauses between batches so the UI gets a turn", async () => {
    const pause = vi.fn(async () => undefined);
    await fillIndex(new NoteIndex(), source(["a.md", "b.md", "c.md"], { pause }), 2);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  test("never overwrites an entry a live event wrote during the fill", async () => {
    const index = new NoteIndex();
    const touched = new Set<string>();
    const read = async (path: string): Promise<NoteSummary> => {
      if (path === "b.md") {
        // The note is edited while the fill is reading it: the live event
        // writes the new version and marks the path.
        index.set(note("b.md", { snippet: "edited" }));
        touched.add("b.md");
      }
      return note(path, { snippet: "as read" });
    };
    await fillIndex(index, source(["a.md", "b.md"], { read, touched }));
    expect(index.get("a.md")?.snippet).toBe("as read");
    expect(index.get("b.md")?.snippet).toBe("edited");
  });

  test("never re-adds a note a live event removed", async () => {
    const index = new NoteIndex();
    const touched = new Set(["gone.md"]);
    await fillIndex(index, source(["a.md", "gone.md"], { touched }));
    expect(index.get("gone.md")).toBeUndefined();
    expect(index.size).toBe(1);
  });

  test("skips files deleted before their summary was ready", async () => {
    const index = new NoteIndex();
    await fillIndex(index, source(["a.md", "deleted.md"], { exists: (p) => p !== "deleted.md" }));
    expect([...index.all().map((n) => n.path)]).toEqual(["a.md"]);
  });

  test("a failed read skips that file only", async () => {
    const index = new NoteIndex();
    const read = async (path: string) => {
      if (path === "bad.md") throw new Error("unreadable");
      return note(path);
    };
    await fillIndex(index, source(["a.md", "bad.md", "c.md"], { read }), 3);
    expect(index.size).toBe(2);
  });

  test("stops when the plugin unloads, and still ends loading", async () => {
    const index = new NoteIndex();
    let stopped = false;
    const pause = async () => {
      stopped = true;
    };
    await fillIndex(index, source(["a.md", "b.md", "c.md"], { pause, stopped: () => stopped }), 1);
    expect(index.size).toBe(1);
    expect(index.loading).toBeNull();
  });

  test("an empty vault still starts and ends loading", async () => {
    const index = new NoteIndex();
    await fillIndex(index, source([]));
    expect(index.size).toBe(0);
    expect(index.loading).toBeNull();
  });
});

describe("NoteIndex.setMany", () => {
  test("adds several notes with one notification", () => {
    const index = new NoteIndex();
    const fn = vi.fn();
    index.subscribe(fn);
    index.setMany([note("a.md"), note("b.md")]);
    expect(index.size).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("progress only moves while loading", () => {
    const index = new NoteIndex();
    index.setMany([note("a.md")], 1);
    expect(index.loading).toBeNull();
    index.beginLoading(3);
    index.setMany([note("b.md")], 2);
    expect(index.loading).toEqual({ done: 2, total: 3 });
  });
});
