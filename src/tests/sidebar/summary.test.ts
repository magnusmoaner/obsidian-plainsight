import { describe, expect, test } from "vitest";
import {
  FileFacts,
  fileLinks,
  firstImage,
  parseBoard,
  summarize,
  summarizeCanvas,
} from "../../sidebar/core/summary";

const facts = (over: Partial<FileFacts> = {}): FileFacts => ({
  path: "Inbox/Note.md",
  basename: "Note",
  folder: "Inbox",
  mtime: 2000,
  ctime: 1000,
  tags: [],
  frontmatter: undefined,
  ...over,
});

describe("firstImage", () => {
  test("finds a wikilink image embed, ignoring size and heading", () => {
    expect(firstImage("text ![[scan.jpg|300]] more")).toBe("scan.jpg");
  });

  test("finds a markdown image", () => {
    expect(firstImage("![alt](Attachments/My%20pic.png)")).toBe("Attachments/My pic.png");
  });

  test("skips non-image embeds", () => {
    expect(firstImage("![[Other note]] ![[doc.pdf]] ![[pic.webp]]")).toBe("pic.webp");
  });

  test("null when there is no image", () => {
    expect(firstImage("plain")).toBeNull();
  });
});

describe("summarize", () => {
  test("builds a complete summary", () => {
    const s = summarize(
      facts({ tags: ["#Work", "#work", "#a/b"], frontmatter: { pinned: true } }),
      "---\npinned: true\n---\nHello world\n- [ ] one\n- [x] two\n![[p.png]]"
    );
    expect(s).toMatchObject({
      path: "Inbox/Note.md",
      title: "Note",
      folder: "Inbox",
      tags: ["Work", "a/b"],
      pinned: true,
      mtime: 2000,
      ctime: 1000,
      thumbnail: "p.png",
    });
    expect(s.snippet).toBe("Hello world one two");
    expect(s.tasks).toHaveLength(2);
    expect(s.searchText).toContain("note");
    expect(s.searchText).toContain("hello world");
  });

  test("pinned only for true or 'true'", () => {
    expect(summarize(facts({ frontmatter: { pinned: "true" } }), "").pinned).toBe(true);
    expect(summarize(facts({ frontmatter: { pinned: "yes" } }), "").pinned).toBe(false);
    expect(summarize(facts(), "").pinned).toBe(false);
  });
});

describe("fileLinks", () => {
  test("plain links with a file extension, in order", () => {
    expect(fileLinks("See [[Other note]] and [[Attachments/scan 1.pdf|scan]] then [[b.png]]")).toEqual([
      "Attachments/scan 1.pdf",
      "b.png",
    ]);
  });

  test("ignores embeds and note links", () => {
    expect(fileLinks("![[pic.png]] [[Note.md]] [[Note]]")).toEqual([]);
  });

  test("a dotted note name is a candidate too; resolution decides", () => {
    expect(fileLinks("[[Møde 2026.10.07]] [[scan.pdf]]")).toEqual(["Møde 2026.10.07", "scan.pdf"]);
  });
});

describe("extracted-text companions", () => {
  test("flags the note and records its source file", () => {
    const s = summarize(
      facts({ frontmatter: { type: "extracted-text" } }),
      "---\ntype: extracted-text\n---\nSource: [[Brev.pdf]]\nText…"
    );
    expect(s.extracted).toBe(true);
    expect(s.sourceLinks).toEqual(["Brev.pdf"]);
  });

  test("an ordinary note is not a companion, even if it links a file", () => {
    const s = summarize(facts(), "See [[Brev.pdf]]");
    expect(s.extracted).toBe(false);
    expect(s.sourceLinks).toEqual([]);
  });
});

const BOARD = [
  "---",
  "kanban-plugin: board",
  "---",
  "",
  "## Todo",
  "",
  "- [ ] Write intro",
  "- [ ] Book venue",
  "",
  "## Done",
  "",
  "- [x] Pick date",
  "",
  "%% kanban:settings",
  "```",
  '{"kanban-plugin":"board"}',
  "```",
  "%%",
].join("\n");

describe("Kanban boards", () => {
  test("parseBoard counts columns and cards, ignoring the settings block", () => {
    expect(parseBoard(BOARD)).toEqual({ columns: ["Todo", "Done"], cards: 3 });
  });

  test("a note with kanban-plugin frontmatter is a board", () => {
    const s = summarize(facts({ frontmatter: { "kanban-plugin": "board" } }), BOARD);
    expect(s.kind).toBe("board");
    expect(s.columns).toEqual(["Todo", "Done"]);
    expect(s.items).toBe(3);
    expect(s.snippet).toBe("Todo · Done");
  });

  test("an ordinary note is a note", () => {
    expect(summarize(facts(), "## Todo\n- a").kind).toBe("note");
  });
});

describe("summarizeCanvas", () => {
  const json = JSON.stringify({
    nodes: [
      { id: "1", type: "text", text: "# Plan\nFirst idea" },
      { id: "2", type: "file", file: "pic.png" },
      { id: "3", type: "text", text: "Second **idea**" },
    ],
    edges: [],
  });

  test("text boxes become the snippet and search text", () => {
    const s = summarizeCanvas(facts({ path: "Board.canvas", basename: "Board" }), json);
    expect(s.kind).toBe("canvas");
    expect(s.items).toBe(3);
    expect(s.snippet).toBe("First idea Second idea");
    expect(s.searchText).toContain("second **idea**");
  });

  test("never has tasks, even if a box holds a checkbox", () => {
    const withTask = JSON.stringify({ nodes: [{ type: "text", text: "- [ ] not a real task" }] });
    expect(summarizeCanvas(facts(), withTask).tasks).toEqual([]);
  });

  test("an unreadable canvas is still listed, empty", () => {
    const s = summarizeCanvas(facts({ basename: "Broken" }), "{not json");
    expect(s).toMatchObject({ kind: "canvas", title: "Broken", items: 0, snippet: "" });
  });
});
