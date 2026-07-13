import { EditorState, StateField } from "@codemirror/state";
import { ChangedRange, Tree, TreeFragment } from "@lezer/common";
// DocInput reads the CM6 Text rope chunk-by-chunk with zero copying; it is an
// esbuild external provided by Obsidian at runtime, so it adds no bundle cost.
import { DocInput } from "@codemirror/language";
import { GFM, parser as baseParser } from "@lezer/markdown";

// Obsidian's own markdown parser has undocumented node names, so we run our
// own @lezer/markdown parse and never depend on Obsidian editor internals.
const parser = baseParser.configure([GFM]);

interface ParseState {
  tree: Tree;
  fragments: readonly TreeFragment[];
}

export const markdownTree = StateField.define<ParseState>({
  create(state) {
    const tree = parser.parse(new DocInput(state.doc));
    return { tree, fragments: TreeFragment.addTree(tree) };
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    const changes: ChangedRange[] = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) =>
      changes.push({ fromA, toA, fromB, toB })
    );
    let fragments = TreeFragment.applyChanges(value.fragments, changes);
    const tree = parser.parse(new DocInput(tr.newDoc), fragments);
    fragments = TreeFragment.addTree(tree, fragments);
    return { tree, fragments };
  },
});

export function treeOf(state: EditorState): Tree {
  return state.field(markdownTree).tree;
}
