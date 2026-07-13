import { EditorState, Prec, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { toggleCode, toggleEm, toggleStrong } from "./commands";
import { InlineMark, inlineMarksIn } from "./syntax";

function marksAround(state: EditorState, pos: number): InlineMark[] {
  const line = state.doc.lineAt(pos);
  return inlineMarksIn(state, line.from, line.to);
}

export function backspaceSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty || sel.head === 0) return null;
  const head = sel.head;

  for (const mark of marksAround(state, head)) {
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
    // so orphaned delimiters like `****` never appear as text.
    const contentFrom = open.to;
    const contentTo = close.from;
    if (head === contentTo && contentTo - contentFrom === 1) {
      return {
        changes: [{ from: mark.from, to: mark.to }],
        userEvent: "delete.format",
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
