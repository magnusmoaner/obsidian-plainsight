import { Extension, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { App, editorInfoField, Notice } from "obsidian";
import { draggedTask, moveTaskOut } from "../drag";
import { landing, moveTask, placeTask } from "./core/task-move";
import { dragAction } from "./internals";

/*
 * A task dragged out of the Tasks list can be dropped into a note that's
 * open: it lands on a line of its own, between two lines, where a line across
 * the note shows. This is in every Markdown editor, whether or not
 * Plainsight's own editing is on.
 */

/** The line (0-based) the task would go before; null while nothing is over the note. */
const setDrop = StateEffect.define<number | null>();

const dropLine = StateField.define<number | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setDrop)) return effect.value;
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (before) => (view: EditorView): DecorationSet => {
      const builder = new RangeSetBuilder<Decoration>();
      const { doc } = view.state;
      if (before !== null) {
        // Above the line it goes before; under the last line when it goes at the end.
        const end = before >= doc.lines;
        const line = doc.line(end ? doc.lines : before + 1);
        builder.add(line.from, line.from, Decoration.line({ class: end ? "ps-task-drop-below" : "ps-task-drop-above" }));
      }
      return builder.finish();
    }),
});

/** Replace the document with `next` as one change, touching only the part that differs. */
function applyText(view: EditorView, next: string): void {
  const now = view.state.doc.toString();
  let start = 0;
  while (start < now.length && start < next.length && now[start] === next[start]) start++;
  let endNow = now.length;
  let endNext = next.length;
  while (endNow > start && endNext > start && now[endNow - 1] === next[endNext - 1]) {
    endNow--;
    endNext--;
  }
  view.dispatch({ changes: { from: start, to: endNow, insert: next.slice(start, endNext) }, userEvent: "move.drop" });
}

export function taskDrop(app: App): Extension {
  // A card's editor on a board isn't a place to drop a task.
  const ours = (view: EditorView) => !!draggedTask() && !view.dom.closest(".psb-editor");
  const clear = (view: EditorView) => {
    if (view.state.field(dropLine, false) != null) view.dispatch({ effects: setDrop.of(null) });
  };

  /** The line the pointer says the task goes before, kept out of the properties at the top. */
  const target = (view: EditorView, evt: DragEvent): number => {
    const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY }, false);
    const line = view.state.doc.lineAt(pos);
    const block = view.lineBlockAt(pos);
    const lower = evt.clientY > view.documentTop + block.top + block.height / 2;
    return landing(view.state.doc.toString().split("\n"), lower ? line.number : line.number - 1).before;
  };

  return [
    dropLine,
    Prec.highest(
      EditorView.domEventHandlers({
        dragover(evt, view) {
          if (!ours(view)) return false;
          const before = target(view, evt);
          if (view.state.field(dropLine) !== before) view.dispatch({ effects: setDrop.of(before) });
          dragAction(app, "Move the task here");
          if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
          evt.preventDefault();
          return true;
        },
        dragleave(evt, view) {
          // Leaving the editor, not passing from one line of it to the next.
          if (!(evt.relatedTarget instanceof Node) || !view.dom.contains(evt.relatedTarget)) clear(view);
          return false;
        },
        drop(evt, view) {
          const task = draggedTask();
          if (!task || !ours(view)) return false;
          evt.preventDefault();
          const before = target(view, evt);
          clear(view);
          const file = view.state.field(editorInfoField, false)?.file;
          if (!file) return true;
          if (file.path === task.path) {
            // Within one note it's one change, which undo takes back.
            const next = moveTask(view.state.doc.toString(), task.ref, before);
            if (next === null) new Notice("That task moved or changed in its note, so it wasn't moved.");
            else applyText(view, next);
          } else {
            void moveTaskOut(app, task, (block) => applyText(view, placeTask(view.state.doc.toString(), before, block)));
          }
          return true;
        },
      })
    ),
  ];
}
