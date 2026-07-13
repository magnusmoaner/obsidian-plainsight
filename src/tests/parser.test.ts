import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { Tree } from "@lezer/common";
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

  test("reuses tree fragments across a small edit", () => {
    const doc = Array.from({ length: 300 }, (_, i) => `paragraph ${i}`).join(
      "\n\n"
    );
    const s = mkState(doc);
    const oldTree = treeOf(s);

    // Small edit near the end of the document.
    const tr = s.update({
      changes: { from: doc.length - 1, insert: "!" },
    });
    const newTree = treeOf(tr.state);

    const collectTrees = (tree: Tree, into: Set<Tree>): void => {
      for (const child of tree.children) {
        if (child instanceof Tree) {
          into.add(child);
          collectTrees(child, into);
        }
      }
    };
    const oldTrees = new Set<Tree>();
    collectTrees(oldTree, oldTrees);

    const newTrees = new Set<Tree>();
    collectTrees(newTree, newTrees);

    // Incremental parsing must reuse at least one subtree by reference.
    const shared = [...newTrees].some((t) => oldTrees.has(t));
    expect(shared).toBe(true);
  });
});
