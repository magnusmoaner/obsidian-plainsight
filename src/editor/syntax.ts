import { EditorState } from "@codemirror/state";
import { SyntaxNode } from "@lezer/common";
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
      result.push(toInlineMark(node.node, type));
      // No `return false`: nested constructs inside this one must be found.
    },
  });
  // Defensive: iterate() is pre-order, so results are already in from-order.
  return result.sort((a, b) => a.from - b.from);
}

function toInlineMark(node: SyntaxNode, type: InlineMarkType): InlineMark {
  const delims: TextSpan[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (DELIM_NAMES.has(child.name)) {
      delims.push({ from: child.from, to: child.to });
    }
  }
  return { type, from: node.from, to: node.to, delims };
}

/**
 * All supported constructs whose full range contains [from, to] (inclusive at
 * both edges), innermost first. Unlike inlineMarksIn this walks the tree
 * upward from the position, so multi-line constructs are found no matter how
 * small the caller's window is — window-scoped queries drop anything that
 * straddles the window (see inlineMarksIn), which is wrong for "what encloses
 * the cursor?" questions.
 */
export function enclosingInlineMarks(
  state: EditorState,
  from: number,
  to: number = from
): InlineMark[] {
  const tree = treeOf(state);
  const found = new Map<string, InlineMark>();
  // Resolve on both sides: at a construct boundary only one side's innermost
  // node chain passes through the construct.
  for (const side of [-1, 1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(from, side);
    for (; node; node = node.parent) {
      const type = CONTAINER_TYPES[node.name];
      if (!type || node.from > from || node.to < to) continue;
      found.set(`${node.from}:${node.to}`, toInlineMark(node, type));
    }
  }
  // Innermost first: later start wins, then shorter span.
  return [...found.values()].sort((a, b) => b.from - a.from || a.to - b.to);
}
