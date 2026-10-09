import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";

/** Where the user's cursor is: a note's path and 0-based line. */
export type CursorListener = (path: string, line: number) => void;

/**
 * Report the cursor's file and line whenever the selection moves in a
 * focused editor. Obsidian has no public "cursor moved" event, so this
 * rides along as a CodeMirror extension; the file comes from the public
 * editorInfoField. Lines are 0-based, matching TaskItem.line.
 */
export function cursorTracker(onCursor: CursorListener): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.focusChanged) return;
    if (!update.view.hasFocus) return;
    const file = update.state.field(editorInfoField, false)?.file;
    if (!file) return;
    const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
    onCursor(file.path, line);
  });
}
