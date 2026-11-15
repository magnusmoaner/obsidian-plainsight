import { EditorState, Extension } from "@codemirror/state";
import { App, editorInfoField } from "obsidian";
import { isBoardFrontmatter } from "../boards/board";
import { sinkDoneTask } from "./core/task-move";
import { matchTaskLine } from "./core/tasks";

const isDoneTask = (line: string) => /^[xX]$/.test(matchTaskLine(line)?.status ?? "");

/**
 * A task ticked done in an open note (Cmd+L, the Tasks plugin's command, its
 * checkbox, the sidebar) goes to the bottom of its task list in the same
 * change, so one undo takes both back. Not in a board's note: the board
 * moves its own cards.
 */
export function sinkDoneTasks(app: App, on: () => boolean): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !on() || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
    const file = tr.startState.field(editorInfoField, false)?.file;
    if (file && isBoardFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter)) return tr;
    const doc = tr.newDoc;
    // A line that's a done task now and was a task, not done, before.
    let ticked: number | null = null;
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      for (let pos = fromB; ticked === null && pos <= toB; ) {
        const line = doc.lineAt(pos);
        const before = tr.startState.doc.lineAt(tr.changes.invertedDesc.mapPos(line.from)).text;
        if (isDoneTask(line.text) && matchTaskLine(before) && !isDoneTask(before)) ticked = line.number - 1;
        pos = line.to + 1;
      }
    });
    if (ticked === null) return tr;
    const text = doc.toString();
    const next = sinkDoneTask(text, ticked);
    if (next === text) return tr;
    // One change over the part that differs.
    let from = 0;
    while (text[from] === next[from]) from++;
    let end = 0;
    while (end < text.length - from && text[text.length - 1 - end] === next[next.length - 1 - end]) end++;
    return [tr, { changes: { from, to: text.length - end, insert: next.slice(from, next.length - end) }, sequential: true }];
  });
}
