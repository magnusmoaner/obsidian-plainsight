import { describe, expect, test } from "vitest";
import { FileFacts, firstFileLink, firstImage, summarize } from "../../sidebar/core/summary";

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

describe("firstFileLink", () => {
  test("finds the first plain link to a non-note file", () => {
    expect(firstFileLink("See [[Other note]] and [[Attachments/scan 1.pdf|scan]] then [[b.png]]")).toBe(
      "Attachments/scan 1.pdf"
    );
  });

  test("ignores embeds and note links", () => {
    expect(firstFileLink("![[pic.png]] [[Note.md]] [[Note]]")).toBeNull();
  });
});

describe("extracted-text companions", () => {
  test("flags the note and records its source file", () => {
    const s = summarize(
      facts({ frontmatter: { type: "extracted-text" } }),
      "---\ntype: extracted-text\n---\nSource: [[Brev.pdf]]\nText…"
    );
    expect(s.extracted).toBe(true);
    expect(s.sourceLink).toBe("Brev.pdf");
  });

  test("an ordinary note is not a companion, even if it links a file", () => {
    const s = summarize(facts(), "See [[Brev.pdf]]");
    expect(s.extracted).toBe(false);
    expect(s.sourceLink).toBeNull();
  });
});
