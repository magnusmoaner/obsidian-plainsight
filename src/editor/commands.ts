import {
  EditorSelection,
  EditorState,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { InlineMark, InlineMarkType, inlineMarksIn } from "./syntax";

const DELIM: Record<InlineMarkType, string> = {
  strong: "**",
  em: "*",
  code: "`",
};

/**
 * Innermost mark of `type` whose range contains [from, to]. Containment is
 * inclusive at both edges: the caret sits at `to` right after typing the
 * closing delimiter, and toggling there must still unformat.
 */
function enclosingMark(
  state: EditorState,
  type: InlineMarkType,
  from: number,
  to: number
): InlineMark | null {
  const lineFrom = state.doc.lineAt(from).from;
  const lineTo = state.doc.lineAt(to).to;
  const candidates = inlineMarksIn(state, lineFrom, lineTo).filter(
    (m) => m.type === type && m.from <= from && m.to >= to
  );
  if (!candidates.length) return null;
  // Later start = more deeply nested (candidates all contain the selection).
  return candidates.reduce((a, b) => (b.from >= a.from ? b : a));
}

/**
 * Pure toggle: returns the transaction spec that toggles `type` formatting
 * around the main selection, or null when there is nothing to act on
 * (empty cursor in whitespace, no enclosing construct).
 */
export function toggleInlineSpec(
  state: EditorState,
  type: InlineMarkType
): TransactionSpec | null {
  const sel = state.selection.main;
  let { from, to } = sel;

  const existing = enclosingMark(state, type, from, to);
  if (existing) {
    return {
      changes: existing.delims.map((d) => ({ from: d.from, to: d.to })),
      userEvent: "delete.format",
    };
  }

  if (sel.empty) {
    const word = state.wordAt(sel.head);
    if (!word) return null;
    from = word.from;
    to = word.to;
  }

  const d = DELIM[type];
  return {
    changes: [
      { from, insert: d },
      { from: to, insert: d },
    ],
    selection: EditorSelection.range(from + d.length, to + d.length),
    userEvent: "input.format",
  };
}

function run(type: InlineMarkType) {
  return (view: EditorView): boolean => {
    const spec = toggleInlineSpec(view.state, type);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}

export const toggleStrong = run("strong");
export const toggleEm = run("em");
export const toggleCode = run("code");
