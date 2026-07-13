import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree, treeOf } from "../editor/parser";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

function nodeNames(state: EditorState): string[] {
  const names: string[] = [];
  treeOf(state).iterate({
    enter(n) {
      names.push(n.name);
    },
  });
  return names;
}

describe("markdownTree", () => {
  test("parses strong emphasis on create", () => {
    const s = mkState("hello **world**");
    expect(nodeNames(s)).toContain("StrongEmphasis");
  });

  test("reparses incrementally on change", () => {
    const s = mkState("hello *world*");
    expect(nodeNames(s)).toContain("Emphasis");
    // turn *world* into **world**
    const tr = s.update({
      changes: [
        { from: 6, insert: "*" },
        { from: 13, insert: "*" },
      ],
    });
    expect(nodeNames(tr.state)).toContain("StrongEmphasis");
    expect(nodeNames(tr.state)).not.toContain("Emphasis");
  });

  test("tree length tracks document length", () => {
    const s = mkState("# heading\n\nsome text");
    expect(treeOf(s).length).toBe(s.doc.length);
  });
});
