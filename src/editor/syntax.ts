import { EditorState } from "@codemirror/state";
import { treeOf } from "./parser";

export type InlineMarkType = "strong" | "em" | "code";

export interface TextSpan {
  from: number;
  to: number;
}

export interface InlineMark {
  type: InlineMarkType;
  from: number;
  to: number;
  delims: TextSpan[];
}

const CONTAINER_TYPES: Record<string, InlineMarkType> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
};

const DELIM_NAMES = new Set(["EmphasisMark", "CodeMark"]);

/**
 * Collect all supported inline formatting constructs that lie fully inside
 * [from, to], with the ranges of their delimiter tokens (e.g. the `**` of a
 * StrongEmphasis). Results are sorted by start position.
 */
export function inlineMarksIn(
  state: EditorState,
  from: number,
  to: number
): InlineMark[] {
  const result: InlineMark[] = [];
  treeOf(state).iterate({
    from,
    to,
    enter(node) {
      const type = CONTAINER_TYPES[node.name];
      if (!type) return;
      // iterate() visits every node touching the range; only report
      // constructs that are fully contained in it.
      if (node.from < from || node.to > to) return;
      const delims: TextSpan[] = [];
      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (DELIM_NAMES.has(cursor.name)) {
            delims.push({ from: cursor.from, to: cursor.to });
          }
        } while (cursor.nextSibling());
      }
      result.push({ type, from: node.from, to: node.to, delims });
      // No `return false`: nested constructs inside this one must be found.
    },
  });
  // Defensive: iterate() is pre-order, so results are already in from-order.
  return result.sort((a, b) => a.from - b.from);
}
