import {
  EditorSelection,
  EditorState,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { enclosingInlineMarks, InlineMark, InlineMarkType } from "./syntax";

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
  // Tree-walk lookup, not a line-scoped window: constructs can span lines.
  return (
    enclosingInlineMarks(state, from, to).find((m) => m.type === type) ?? null
  );
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
