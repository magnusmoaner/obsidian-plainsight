import { EditorState, Prec, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { toggleCode, toggleEm, toggleStrong } from "./commands";
import { enclosingInlineMarks, InlineMark } from "./syntax";

/**
 * Expand a construct deletion outward through enclosing constructs whose
 * content it was: deleting the strong in `***a***` must also take the em's
 * delimiters, or they'd survive as visible `**`.
 */
function cascadeDeletion(marks: InlineMark[], target: InlineMark): InlineMark {
  let result = target;
  for (const outer of marks) {
    if (outer === result || outer.delims.length < 2) continue;
    const open = outer.delims[0];
    const close = outer.delims[outer.delims.length - 1];
    if (open.to === result.from && close.from === result.to) {
      result = outer;
    }
  }
  return result;
}

export function backspaceSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty || sel.head === 0) return null;
  const head = sel.head;

  // Tree-walk (not line-scoped): constructs can span lines. Innermost first.
  const marks = enclosingInlineMarks(state, head);
  for (const mark of marks) {
    if (mark.delims.length < 2) continue;
    const open = mark.delims[0];
    const close = mark.delims[mark.delims.length - 1];

    // Case 1: cursor sits right after the closing delimiter → unformat.
    // (Default deleteCharBackward is atomic-range-aware and would eat the
    // whole closing delimiter, orphaning the opener as visible syntax.)
    if (close.to === head) {
      return {
        changes: [
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ],
        userEvent: "delete.format",
      };
    }

    // Case 2: deleting the only content character → drop the whole construct
    // (cascading outward) so orphaned delimiters never appear as text.
    if (head === close.from && close.from - open.to === 1) {
      const target = cascadeDeletion(marks, mark);
      return {
        changes: [{ from: target.from, to: target.to }],
        userEvent: "delete.format",
      };
    }

    // Case 3: cursor at content start, right behind the hidden opening
    // delimiter. Visually the previous character is whatever precedes the
    // construct — delete that, not the delimiter. At doc start, unformat.
    if (open.to === head) {
      if (mark.from === 0) {
        return {
          changes: [
            { from: open.from, to: open.to },
            { from: close.from, to: close.to },
          ],
          userEvent: "delete.format",
        };
      }
      return {
        changes: [{ from: mark.from - 1, to: mark.from }],
        userEvent: "delete.backward",
      };
    }
  }
  return null;
}

function runBackspace(view: EditorView): boolean {
  const spec = backspaceSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

// Prec.high so these outrank the default CM keymaps and Obsidian's own
// bold/italic handlers while focus is inside the editor.
export const wysiwygKeymap = Prec.high(
  keymap.of([
    { key: "Backspace", run: runBackspace },
    { key: "Mod-b", run: toggleStrong },
    { key: "Mod-i", run: toggleEm },
    { key: "Mod-`", run: toggleCode },
  ])
);
