import { App, Notice, TFile } from "obsidian";
import { takeTask } from "./sidebar/core/task-move";
import type { TaskRef } from "./sidebar/core/task-move";

/*
 * The task being dragged out of the Tasks list, while it is. The sidebar
 * sets it; the places a task can be dropped (a note's editor, a note's card,
 * a board) read it.
 */
export interface TaskDrag {
  /** The note the task is in. */
  path: string;
  ref: TaskRef;
}

let dragged: TaskDrag | null = null;

export const draggedTask = (): TaskDrag | null => dragged;
export const setDraggedTask = (task: TaskDrag | null): void => void (dragged = task);

/**
 * Move a task out of its note. `place` puts its lines in their new home
 * first; only when that's done is the task removed from the old note, so a
 * move that goes wrong part-way leaves the task where it was, or in both
 * places, never in neither. Returns whether it was placed.
 */
export async function moveTaskOut(app: App, from: TaskDrag, place: (block: string[]) => void | Promise<void>): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(from.path);
  const taken = file instanceof TFile ? takeTask(await app.vault.read(file), from.ref) : null;
  if (!(file instanceof TFile) || !taken) {
    new Notice("That task moved or changed in its note, so it wasn't moved.");
    return false;
  }
  try {
    await place(taken.block);
  } catch (err) {
    new Notice(`The task wasn't moved: ${(err as Error).message}`);
    return false;
  }
  let left = false;
  await app.vault.process(file, (data) => {
    const now = takeTask(data, from.ref);
    left = !now;
    return now ? now.text : data;
  });
  if (left) new Notice(`The task is in its new place, but “${file.basename}” changed meanwhile, so it's still there too.`, 8000);
  return true;
}

/**
 * Start a drag with a copy of `el` following the pointer, turned a little
 * for the sidebar's rows and the boards' cards and lists alike. `start` hands the copy to Obsidian's drag manager;
 * `moved` is called as the pointer moves, and `ended` when the drag is over.
 */
export function dragCopy(
  evt: DragEvent,
  el: HTMLElement,
  start: (ghost: { el: HTMLElement; anchor: { x: number; y: number }; action: HTMLElement }) => boolean,
  moved?: (move: DragEvent, ghost: HTMLElement) => void,
  ended?: () => void
): void {
  const box = el.getBoundingClientRect();
  const ghost = createDiv("ps-drag-ghost");
  const copy = ghost.appendChild(el.cloneNode(true) as HTMLElement);
  copy.addClass("ps-drag-copy");
  copy.removeClasses(["is-active", "is-drop-target"]);
  copy.style.width = `${box.width}px`;
  // The copy hangs from the pointer by its top left corner, so what's
  // under the pointer stays in view. It starts where the card is and
  // slides there (the styles do the sliding once it's marked settled).
  const hang = { x: 12, y: 18 };
  ghost.style.setProperty("--ps-from-x", `${box.left - evt.clientX - hang.x}px`);
  ghost.style.setProperty("--ps-from-y", `${box.top - evt.clientY - hang.y}px`);
  // What a drop would do, in words: beside the pointer, above the copy, and always inside the window.
  const { doc, win } = el;
  const action = doc.body.createDiv("ps-drag-action");
  if (!start({ el: ghost, anchor: { x: -hang.x, y: -hang.y }, action })) {
    action.remove();
    return void evt.preventDefault();
  }
  let settled = false;
  const follow = (move: DragEvent) => {
    if (move.clientX === 0 && move.clientY === 0) return;
    if (!settled) {
      settled = true;
      // Two frames on: Obsidian has put the copy on the page, drawn where the card is.
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => ghost.addClass("is-settled")));
    }
    moved?.(move, ghost);
    // To the right of the pointer, level with it and so just above the copy; held inside the window.
    const x = Math.min(Math.max(move.clientX + 18, 8), win.innerWidth - action.offsetWidth - 8);
    const y = Math.min(Math.max(move.clientY - action.offsetHeight / 2, 8), win.innerHeight - action.offsetHeight - 8);
    action.style.translate = `${x}px ${y}px`;
  };
  let over = false;
  const done = () => {
    if (over) return;
    over = true;
    doc.removeEventListener("dragover", follow, true);
    doc.removeEventListener("dragend", done, true);
    doc.removeEventListener("drop", later, true);
    action.remove();
    el.removeClass("is-dragging");
    ended?.();
  };
  // After the drop itself has been handled.
  const later = () => win.setTimeout(done);
  doc.addEventListener("dragover", follow, true);
  doc.addEventListener("dragend", done, true);
  doc.addEventListener("drop", later, true);
  // A source that a redraw has taken off the page still gets its own dragend.
  el.addEventListener("dragend", done, { once: true });
  // A frame later: a source that changes while the drag is starting can end it.
  win.requestAnimationFrame(() => !over && el.addClass("is-dragging"));
}
