import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree, treeOf } from "../editor/parser";
import { readWiki } from "../editor/wikilinks";

function nodes(doc: string): string[] {
  const s = EditorState.create({ doc, extensions: [markdownTree] });
  const out: string[] = [];
  treeOf(s).iterate({
    enter(n) {
      if (n.name === "WikiLink" || n.name === "Embed" || n.name === "Link" || n.name === "Image") {
        out.push(`${n.name}:${doc.slice(n.from, n.to)}`);
      }
    },
  });
  return out;
}

function info(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdownTree] });
  let found: ReturnType<typeof readWiki> | null = null;
  treeOf(s).iterate({
    enter(n) {
      if (!found && (n.name === "WikiLink" || n.name === "Embed")) found = readWiki(n.node, s.doc);
    },
  });
  return found!;
}

describe("WikiLinks parser", () => {
  test("wikilinks and embeds, not Links/Images", () => {
    expect(nodes("a [[Note]] b")).toEqual(["WikiLink:[[Note]]"]);
    expect(nodes("![[img.png|300]]")).toEqual(["Embed:![[img.png|300]]"]);
  });

  test("invalid ones are plain text", () => {
    for (const doc of ["[[]]", "[[ ]]", "[[#]]", "[[Note\nmore]]", "[[a]b]]"]) expect(nodes(doc)).toEqual([]);
  });

  test("code wins", () => {
    expect(nodes("`[[Note]]`")).toEqual([]);
    expect(nodes("```\n[[Note]]\n```")).toEqual([]);
  });

  test("markdown links still parse", () => {
    expect(nodes("[t](https://x.dk) and [[N]]")).toEqual(["Link:[t](https://x.dk)", "WikiLink:[[N]]"]);
  });

  test("[[[Note]]] is a literal bracket plus a link", () => {
    expect(nodes("[[[Note]]]")).toEqual(["WikiLink:[[Note]]"]);
  });
});

describe("readWiki", () => {
  test("plain, alias, heading, block, local", () => {
    expect(info("[[Note]]")).toMatchObject({ path: "Note", alias: null, display: "Note", linktext: "Note" });
    expect(info("[[Note|alias]]")).toMatchObject({ alias: "alias", display: "alias" });
    expect(info("[[Note#H1#H2]]")).toMatchObject({ subpath: ["H1", "H2"], display: "Note › H1 › H2", linktext: "Note#H1#H2" });
    expect(info("[[Note#^abc]]")).toMatchObject({ blockRef: "abc", display: "Note › ^abc" });
    expect(info("[[#Local]]")).toMatchObject({ path: "", display: "Local", linktext: "#Local" });
  });

  test("an empty alias falls back to the target", () => {
    expect(info("[[Note|]]")).toMatchObject({ alias: "", display: "Note" });
  });

  test("table pipe and embed sizes", () => {
    expect(info("| [[Note\\|al]] |")).toMatchObject({ alias: "al", display: "al" });
    expect(info("![[i.png|300x200]]")).toMatchObject({ embed: true, width: 300, height: 200, display: "i.png" });
    expect(info("![[i.png|alt|300]]")).toMatchObject({ width: 300 });
  });
});
