import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";

/** Where the user's cursor is: a note's path and 0-based line. */
export type CursorListener = (path: string, line: number) => void;

/**
 * Report the cursor's file and line when it moves to a *different line* in
 * a focused editor. Obsidian has no public "cursor moved" event, so this
 * rides along as a CodeMirror extension; the file comes from the public
 * editorInfoField. Typing, or moving along the same line, reports nothing:
 * the check is one lineAt lookup and a comparison. Lines are 0-based,
 * matching TaskItem.line.
 */
export function cursorTracker(onCursor: CursorListener): Extension {
  const last = new WeakMap<EditorView, string>();
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.focusChanged) return;
    if (!update.view.hasFocus) return;
    const file = update.state.field(editorInfoField, false)?.file;
    if (!file) return;
    const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
    const key = `${file.path}\u0000${line}`;
    if (last.get(update.view) === key) return;
    last.set(update.view, key);
    onCursor(file.path, line);
  });
}
