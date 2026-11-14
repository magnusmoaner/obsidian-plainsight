import { Extension, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { App, editorInfoField, Notice, Platform, setIcon } from "obsidian";
import { dragCopy, draggedTask, moveTaskOut, overBoard, setDraggedTask, taskCardCopy } from "../drag";
import { localISODate } from "./core/format";
import { taskDetails } from "./core/task-details";
import { landing, moveTask, placeTask } from "./core/task-move";
import { matchTaskLine } from "./core/tasks";
import { dragAction, startTaskDrag } from "./internals";
import { taskBadges } from "./task-badges";

/*
 * Tasks dragged in a note that's open. A task from the Tasks list, a card off
 * a board or a task of the note itself can be dropped into it: it lands on a
 * line of its own, between two lines, where a line across the note shows. And
 * a task line has a grip to drag it by, to another line or onto a board. This
 * is in every Markdown editor, whether or not Plainsight's own editing is on.
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

/**
 * The grip: one per editor, shown left of the task line the pointer is level
 * with. Dragging it drags that task, with the lines under it.
 */
function taskGrip(app: App): Extension {
  return ViewPlugin.fromClass(
    class {
      private grip = createDiv({ cls: "ps-task-grip", attr: { draggable: "true", "aria-label": "Drag to move the task" } });
      /** The line (1-based) the grip is shown for; 0 while it's hidden. */
      private line = 0;

      constructor(private view: EditorView) {
        setIcon(this.grip, "grip-vertical");
        this.grip.hide();
        // In the scroller, as the editor's own cursor layer is: it scrolls with the text.
        view.scrollDOM.appendChild(this.grip);
        view.scrollDOM.addEventListener("mousemove", this.move);
        view.scrollDOM.addEventListener("mouseleave", this.hide);
        this.grip.addEventListener("dragstart", this.start);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.geometryChanged) this.hide();
      }

      destroy(): void {
        this.view.scrollDOM.removeEventListener("mousemove", this.move);
        this.view.scrollDOM.removeEventListener("mouseleave", this.hide);
        this.grip.remove();
      }

      private hide = (): void => {
        this.line = 0;
        this.grip.hide();
      };

      private move = (evt: MouseEvent): void => {
        const { view, grip } = this;
        if (evt.target instanceof Node && grip.contains(evt.target)) return;
        // Not while text is being selected, and not in a card's editor on a board.
        if (evt.buttons || view.dom.closest(".psb-editor")) return this.hide();
        const line = view.state.doc.lineAt(view.lineBlockAtHeight(evt.clientY - view.documentTop).from);
        if (line.number === this.line) return;
        // Obsidian's own word on what's a task line: not one inside a code block.
        const { node } = view.domAtPos(line.from);
        const lineEl = matchTaskLine(line.text) ? (node instanceof Element ? node : node.parentElement)?.closest(".HyperMD-task-line") : null;
        // Just left of the task's box (in source mode, of its "- [ ]"), and
        // of the arrow that folds a task with lines under it.
        const at =
          lineEl?.querySelector(".task-list-item-checkbox")?.getBoundingClientRect() ??
          (lineEl ? view.coordsAtPos(line.from + /^\s*/.exec(line.text)![0].length, 1) : null);
        if (!at) return this.hide();
        const fold = lineEl!.querySelector(".cm-fold-indicator .collapse-indicator")?.getBoundingClientRect();
        const base = view.scrollDOM.getBoundingClientRect();
        grip.style.top = `${at.top - base.top + view.scrollDOM.scrollTop}px`;
        grip.style.left = `${Math.min(at.left, fold?.left ?? at.left) - base.left + view.scrollDOM.scrollLeft}px`;
        grip.style.height = `${at.bottom - at.top}px`;
        grip.show();
        this.line = line.number;
      };

      private start = (evt: DragEvent): void => {
        const { view } = this;
        const file = view.state.field(editorInfoField, false)?.file;
        const line = this.line ? view.state.doc.line(this.line) : null;
        const task = line && matchTaskLine(line.text);
        if (!file || !line || !task) return void evt.preventDefault();
        const details = taskDetails(task.text);
        dragCopy(
          evt,
          this.grip,
          (ghost) => {
            if (!startTaskDrag(app, evt, details.description || task.text, ghost)) return false;
            setDraggedTask({
              path: file.path,
              ref: { line: line.number - 1, ...task },
              buffer: { read: () => view.state.doc.toString(), write: (text) => applyText(view, text) },
            });
            // What hangs from the pointer is the task as a card, in a note and over a board alike.
            ghost.el.addClass("is-card");
            taskCardCopy(ghost.el, task.status, task.text, (foot) => taskBadges(foot, details, /[xX-]/.test(task.status), localISODate()));
            return true;
          },
          overBoard,
          () => setDraggedTask(null)
        );
      };
    }
  );
}

export function taskDrop(app: App): Extension {
  // Not over a board in the note: its lists take what's dropped on them, and
  // a card's editor isn't a place to drop a task.
  const ours = (evt: DragEvent) => {
    const el = evt.target instanceof Element ? evt.target : evt.target instanceof Node ? evt.target.parentElement : null;
    return !!draggedTask() && !el?.closest(".psb-board");
  };
  const clear = (view: EditorView) => {
    if (view.state.field(dropLine, false) != null) view.dispatch({ effects: setDrop.of(null) });
  };

  /** The line the pointer says the task goes before, kept out of the properties at the top. */
  const target = (view: EditorView, evt: DragEvent): number => {
    const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY }, false);
    // What's drawn as one block can be several lines (an embedded board, a
    // table): the task goes before its first line or after its last.
    const block = view.lineBlockAt(pos);
    const lower = evt.clientY > view.documentTop + block.top + block.height / 2;
    const line = view.state.doc.lineAt(lower ? block.to : block.from);
    return landing(view.state.doc.toString().split("\n"), lower ? line.number : line.number - 1).before;
  };

  return [
    dropLine,
    // Dragging is Obsidian's own, on desktop.
    Platform.isDesktop ? taskGrip(app) : [],
    Prec.highest(
      EditorView.domEventHandlers({
        dragover(evt, view) {
          if (!ours(evt)) {
            clear(view);
            return false;
          }
          const before = target(view, evt);
          if (view.state.field(dropLine) !== before) view.dispatch({ effects: setDrop.of(before) });
          dragAction(app, draggedTask()!.card ? "Move the card here" : "Move the task here");
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
          if (!task || !ours(evt)) return false;
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
