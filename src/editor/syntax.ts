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

export interface Heading {
  /** 1..6 */
  level: number;
  /** Full heading node range. ATX headings never span lines. */
  from: number;
  to: number;
  /** First character of the visible text, i.e. just past the hidden `## `. */
  contentFrom: number;
  /** Hideable spans: the opening `## ` and any closing ` ##`. */
  delims: TextSpan[];
}

export interface Callout {
  /** Lowercased type from `[!type]`, e.g. "quote". */
  type: string;
  /** Full Blockquote range. */
  from: number;
  to: number;
  /** The `[!type]` token — replaced by the icon/type-picker widget. */
  tokenFrom: number;
  /** Start of the title text, past the token and its trailing space. */
  titleFrom: number;
  /** Each `>` plus its following space, one span per line. */
  quoteMarks: TextSpan[];
}

const CONTAINER_TYPES: Record<string, InlineMarkType> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
};

const DELIM_NAMES = new Set(["EmphasisMark", "CodeMark"]);

const ATX_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

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

const SPACE = /[ \t]/;

/**
 * Describe an ATX heading node, or null when it must not be treated as one.
 * Setext headings are deliberately excluded: collapsing their underline needs
 * a replace decoration spanning a line break, which CM6 forbids from a
 * ViewPlugin. They stay plain visible Markdown.
 */
function toHeading(
  state: EditorState,
  node: SyntaxNode,
  level: number
): Heading | null {
  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "HeaderMark") marks.push(child.node);
  }
  if (!marks.length) return null;

  // HeaderMark covers only the `#`s — the separating space is a gap in the
  // tree. Hide it too, or heading text would sit one space off the margin.
  const open = marks[0];
  let contentFrom = open.to;
  while (contentFrom < node.to && SPACE.test(charAt(state, contentFrom))) {
    contentFrom++;
  }
  // A bare `#` with no space is already ATXHeading1 to Lezer. Hiding it there
  // would blank the character mid-keystroke and then flash it back as plain
  // text on the next one — precisely the reflow this plugin exists to avoid.
  // It is not a heading until the space lands.
  if (contentFrom === open.to) return null;

  const delims: TextSpan[] = [{ from: open.from, to: contentFrom }];
  if (marks.length > 1) {
    const close = marks[marks.length - 1];
    let closeFrom = close.from;
    while (closeFrom > contentFrom && SPACE.test(charAt(state, closeFrom - 1))) {
      closeFrom--;
    }
    if (closeFrom >= contentFrom) delims.push({ from: closeFrom, to: close.to });
  }
  return { level, from: node.from, to: node.to, contentFrom, delims };
}

function charAt(state: EditorState, pos: number): string {
  return state.doc.sliceString(pos, pos + 1);
}

/**
 * ATX headings lying fully inside [from, to]. Same window contract as
 * inlineMarksIn: callers must expand to whole lines.
 */
export function headingsIn(
  state: EditorState,
  from: number,
  to: number
): Heading[] {
  const result: Heading[] = [];
  treeOf(state).iterate({
    from,
    to,
    enter(node) {
      const level = ATX_LEVELS[node.name];
      if (!level) return;
      if (node.from < from || node.to > to) return;
      const heading = toHeading(state, node.node, level);
      if (heading) result.push(heading);
    },
  });
  return result;
}

/** The ATX heading containing `pos`, or null. Resolves on both sides so a
 * caret at either edge of the heading line still finds it. */
export function enclosingHeading(
  state: EditorState,
  pos: number
): Heading | null {
  const tree = treeOf(state);
  for (const side of [-1, 1] as const) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      const level = ATX_LEVELS[node.name];
      if (!level) continue;
      const heading = toHeading(state, node, level);
      if (heading) return heading;
    }
  }
  return null;
}

const CALLOUT_TOKEN = /^\[!([a-zA-Z_-]+)\]$/;

/**
 * Describe a Blockquote as a callout, or null if it is an ordinary quote.
 *
 * Lezer has no callout node: `> [!quote] Title` is a Blockquote whose first
 * Paragraph opens with what the parser takes to be a Link (`[!quote]`). That
 * Link is the whole token, which makes both the type and the replace range a
 * single node lookup.
 */
function toCallout(state: EditorState, node: SyntaxNode): Callout | null {
  let paragraph: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "Paragraph") {
      paragraph = child.node;
      break;
    }
  }
  if (!paragraph) return null;

  // Only the opening `>` is a child of the Blockquote; every continuation
  // QuoteMark is nested inside the Paragraph, so this must walk the subtree
  // rather than the direct children.
  const quoteMarks: TextSpan[] = [];
  treeOf(state).iterate({
    from: node.from,
    to: node.to,
    enter(child) {
      if (child.name !== "QuoteMark") return;
      // The space after `>` is a gap in the tree, as with heading markers.
      const to =
        child.to < node.to && SPACE.test(charAt(state, child.to))
          ? child.to + 1
          : child.to;
      quoteMarks.push({ from: child.from, to });
    },
  });

  const token = paragraph.firstChild;
  if (!token || token.name !== "Link" || token.from !== paragraph.from) {
    return null;
  }
  const match = CALLOUT_TOKEN.exec(state.doc.sliceString(token.from, token.to));
  if (!match) return null;

  let titleFrom = token.to;
  while (titleFrom < node.to && SPACE.test(charAt(state, titleFrom))) {
    titleFrom++;
  }
  return {
    type: match[1].toLowerCase(),
    from: node.from,
    to: node.to,
    tokenFrom: token.from,
    titleFrom,
    quoteMarks,
  };
}

/** Callouts lying fully inside [from, to]. Same whole-line window contract as
 * inlineMarksIn. Nested callouts are not reported: none exist in practice and
 * they would need the quote marks grouped per nesting depth. */
export function calloutsIn(
  state: EditorState,
  from: number,
  to: number
): Callout[] {
  const result: Callout[] = [];
  treeOf(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "Blockquote") return;
      if (node.from < from || node.to > to) return false;
      const callout = toCallout(state, node.node);
      if (callout) result.push(callout);
      return false; // don't descend into nested quotes
    },
  });
  return result;
}

/** The callout containing `pos`, or null. */
export function enclosingCallout(
  state: EditorState,
  pos: number
): Callout | null {
  const tree = treeOf(state);
  for (const side of [-1, 1] as const) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (node.name !== "Blockquote") continue;
      const callout = toCallout(state, node);
      if (callout) return callout;
    }
  }
  return null;
}
