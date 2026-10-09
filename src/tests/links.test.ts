import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { enclosingLink, linksIn, shortUrl } from "../editor/links";

const mk = (doc: string) => EditorState.create({ doc, extensions: [markdownTree] });
const all = (doc: string) => linksIn(mk(doc), 0, doc.length);

describe("linksIn", () => {
  test("markdown link: text editable, syntax hidden", () => {
    const [l] = all("see [text](https://x.dk/a) end");
    expect(l).toMatchObject({
      kind: "markdown",
      text: { from: 5, to: 9 },
      target: "https://x.dk/a",
      external: true,
      hidden: [
        { from: 4, to: 5 },
        { from: 9, to: 26 },
      ],
    });
  });

  test("[foo] without a URL is not a link", () => {
    expect(all("[foo] bar")).toEqual([]);
  });

  test("aliased wikilink: alias editable", () => {
    const [l] = all("[[Note|alias]]");
    expect(l).toMatchObject({ kind: "wiki", text: { from: 7, to: 12 }, target: "Note", display: "alias" });
  });

  test("unaliased wikilink: derived, atomic, shown by a widget", () => {
    const [l] = all("[[Note#H]]");
    expect(l).toMatchObject({ text: null, display: "Note › H", target: "Note#H", hidden: [] });
  });

  test("bare URL and autolink are shortened, never doubled", () => {
    expect(all("go https://github.com/a/b/plainsight now").map((l) => [l.kind, l.display])).toEqual([
      ["url", "github.com/…/plainsight"],
    ]);
    expect(all("<https://x.dk>").map((l) => [l.from, l.to, l.display])).toEqual([[0, 14, "x.dk"]]);
    expect(all("[t](https://x.dk)")).toHaveLength(1);
  });

  test("evernote links are flagged, not external", () => {
    const [l] = all("[A](evernote:///view/1/s1/abc/abc/)");
    expect(l).toMatchObject({ evernote: true, external: false });
  });

  test("internal markdown link", () => {
    expect(all("[n](Notes/x.md)")[0]).toMatchObject({ external: false, target: "Notes/x.md" });
  });
});

describe("enclosingLink and shortUrl", () => {
  test("finds the link at either edge and inside", () => {
    const s = mk("a [[Note|al]] b");
    expect(enclosingLink(s, 2)?.kind).toBe("wiki");
    expect(enclosingLink(s, 9)?.kind).toBe("wiki");
    expect(enclosingLink(s, 14)).toBeNull();
  });

  test("shortUrl", () => {
    expect(shortUrl("https://www.example.com")).toBe("example.com");
    expect(shortUrl("https://example.com/a")).toBe("example.com/a");
  });
});
