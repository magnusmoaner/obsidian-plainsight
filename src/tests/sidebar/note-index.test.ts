import { describe, expect, test, vi } from "vitest";
import { NoteIndex } from "../../sidebar/core/note-index";
import { renamedPath } from "../../sidebar/core/types";
import { note } from "./fixtures";

describe("NoteIndex", () => {
  test("set, get, all and size", () => {
    const index = new NoteIndex();
    index.set(note("a.md"));
    index.set(note("b.md"));
    expect(index.size).toBe(2);
    expect(index.get("a.md")?.title).toBe("a");
    expect(index.all().map((n) => n.path).sort()).toEqual(["a.md", "b.md"]);
  });

  test("set replaces an existing entry", () => {
    const index = new NoteIndex();
    index.set(note("a.md", { snippet: "old" }));
    index.set(note("a.md", { snippet: "new" }));
    expect(index.size).toBe(1);
    expect(index.get("a.md")?.snippet).toBe("new");
  });

  test("delete and deleteUnder", () => {
    const index = new NoteIndex();
    index.replaceAll([note("x/a.md"), note("x/y/b.md"), note("z.md")]);
    index.delete("z.md");
    index.deleteUnder("x");
    expect(index.size).toBe(0);
  });

  test("notifies subscribers on change, not on no-op deletes", () => {
    const index = new NoteIndex();
    const fn = vi.fn();
    const unsubscribe = index.subscribe(fn);
    index.set(note("a.md"));
    index.delete("missing.md");
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
    index.set(note("b.md"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("renamedPath", () => {
  test("the renamed item itself and everything beneath it move", () => {
    expect(renamedPath("Projects", "Projects", "Work")).toBe("Work");
    expect(renamedPath("Projects/Clients/A", "Projects", "Work")).toBe("Work/Clients/A");
  });
  test("siblings that merely share a prefix don't", () => {
    expect(renamedPath("Projects 2026", "Projects", "Work")).toBe("Projects 2026");
    expect(renamedPath("Other/Projects", "Projects", "Work")).toBe("Other/Projects");
  });
});
