import { Annotation, EditorSelection, EditorState, Facet, Prec, StateField, Transaction, TransactionSpec } from "@codemirror/state";
import { EditorView, WidgetType, keymap } from "@codemirror/view";
import type { TaskDetails } from "../sidebar/core/task-details";
import { Span, taskFields } from "../sidebar/core/task-fields";
import { treeOf } from "./parser";

/*
 * A task's Tasks-plugin fields in a note: hidden, shown as badges under its
 * text, and changed only through the badges. The caret never sits after the
 * fields, and Backspace/Delete never reach into them.
 */

/** A task's first line: its text runs from `from` (after "[ ] ") to `to`; its status character sits at `statusAt`. */
export interface TaskLine {
  from: number;
  to: number;
  status: string;
  statusAt: number;
}

/**
 * The tasks whose list marker starts in from..to. Found from the list marker,
 * not GFM's TaskMarker, which knows only [ ] and [x]: Tasks also uses [/], [-]
 * and other status characters.
 */
export function tasksIn(state: EditorState, from: number, to: number): TaskLine[] {
  const out: TaskLine[] = [];
  treeOf(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "ListMark" || node.from < from || node.from > to) return;
      const line = state.doc.lineAt(node.from);
      const m = /^ \[(.)\]( ?)/u.exec(state.doc.sliceString(node.to, line.to));
      if (!m) return;
      const statusAt = node.to + 2;
      out.push({ from: node.to + 4 + m[2].length, to: line.to, status: m[1], statusAt });
    },
  });
  return out;
}

/** Where the user just typed: a field or tag ending there is still being written. */
export const typingAt = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    const sel = tr.newSelection.main;
    if (tr.docChanged && tr.isUserEvent("input.type") && sel.empty) return sel.head;
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
});

/** The hidden field spans of `task`, in document positions. */
export function hiddenFields(state: EditorState, task: TaskLine, typing = state.field(typingAt, false) ?? null): Span[] {
  const text = state.doc.sliceString(task.from, task.to);
  const cursor = typing !== null && typing >= task.from && typing <= task.to ? typing - task.from : -1;
  return taskFields(text, cursor).hidden.map((s) => ({ from: task.from + s.from, to: task.from + s.to }));
}

/** The hidden field spans on `pos`'s line, if it's a task. */
function hiddenOnLine(state: EditorState, pos: number): Span[] {
  const line = state.doc.lineAt(pos);
  const task = tasksIn(state, line.from, line.to)[0];
  return task ? hiddenFields(state, task) : [];
}

/** The fields hidden at the end of the task on `pos`'s line, if any. */
function hiddenTail(state: EditorState, pos: number): Span | null {
  const last = hiddenOnLine(state, pos).pop();
  return last && last.to === state.doc.lineAt(pos).to ? last : null;
}

/** Lets Enter step past the fields to the end of the line. */
const pastFields = Annotation.define<boolean>();

/**
 * The user's own edits keep out of hidden fields: what they delete or
 * replace there is left alone, unless the whole line goes.
 */
const guardFields = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input") || tr.isUserEvent("move"))) return tr;
  if (tr.startState.selection.ranges.length > 1) return tr;
  const start = tr.startState;
  const specs: { from: number; to?: number; insert?: string }[] = [];
  let changed = false;
  let caret: number | null = null;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const insert = inserted.toString();
    const spans: Span[] = [];
    if (toA > fromA) {
      for (const task of tasksIn(start, start.doc.lineAt(fromA).from, toA)) {
        const line = start.doc.lineAt(task.from);
        if (fromA <= line.from && toA >= line.to) continue; // the whole line goes
        for (const s of hiddenFields(start, task)) if (s.from < toA && s.to > fromA) spans.push(s);
      }
    }
    if (!spans.length) return void specs.push({ from: fromA, to: toA, insert });
    changed = true;
    let at = fromA;
    let pending: string | null = insert;
    for (const s of spans) {
      if (s.from > at) {
        specs.push({ from: at, to: s.from, insert: pending ?? "" });
        if (pending) caret = at;
        pending = null;
      }
      at = Math.max(at, s.to);
    }
    if (at < toA) {
      specs.push({ from: at, to: toA, insert: pending ?? "" });
      if (pending) caret = at;
      pending = null;
    }
    if (pending) {
      specs.push({ from: fromA, insert: pending });
      caret = fromA;
    }
  });
  if (!changed) return tr;
  const changes = start.changes(specs);
  const head = caret !== null ? changes.mapPos(caret, 1) : changes.mapPos(start.selection.main.head, -1);
  return {
    changes,
    selection: EditorSelection.cursor(head),
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: tr.scrollIntoView,
  } as TransactionSpec;
});

/**
 * The caret never rests inside a task's hidden fields, or after them at the
 * end of the line, where typing would land among them. It goes to just
 * before them. (Space typed while the Tasks suggest box was open can end up
 * hidden around the caret once the box inserts a field.)
 */
const caretBeforeFields = EditorState.transactionFilter.of((tr) => {
  if (!(tr.docChanged || tr.selection) || tr.annotation(pastFields)) return tr;
  const sel = tr.newSelection;
  if (sel.ranges.length > 1 || !sel.main.empty) return tr;
  const state = tr.state;
  const head = sel.main.head;
  const lineEnd = state.doc.lineAt(head).to;
  const span = hiddenOnLine(state, head).find((s) => (head > s.from && head < s.to) || (head === s.to && s.to === lineEnd));
  if (!span || span.from === head) return tr;
  return [tr, { selection: EditorSelection.cursor(span.from), sequential: true }];
});

/** Enter right after the text starts the next line after the fields, so they stay with their task. */
const enterPastFields = Prec.highest(
  keymap.of([
    {
      key: "Enter",
      run: (view) => {
        const sel = view.state.selection;
        if (sel.ranges.length > 1 || !sel.main.empty) return false;
        const tail = hiddenTail(view.state, sel.main.head);
        if (!tail || sel.main.head !== tail.from) return false;
        view.dispatch({ selection: EditorSelection.cursor(tail.to), annotations: pastFields.of(true) });
        return false; // Obsidian's own Enter carries on from there
      },
    },
  ])
);

/** How a note's badge row changes its task. */
export interface TaskBadgeEdits {
  change(edit: (text: string) => string): void;
  status: string;
  setStatus(status: string): void;
  inTasks?: () => void;
}

/** Draws a task's badges (main.ts supplies the sidebar's), and Tasks' Edit dialog if there is one. */
export interface TaskBadgeServices {
  render(parent: HTMLElement, details: TaskDetails, closed: boolean, edits: TaskBadgeEdits): void;
  editLine: (() => ((line: string) => Promise<string>) | null) | null;
}
export const taskBadgeServices = Facet.define<TaskBadgeServices, TaskBadgeServices | null>({
  combine: (values) => values[0] ?? null,
});

/** The badge row under a task's text: a widget at the end of its line, on a row of its own by CSS. */
export class TaskBadgesWidget extends WidgetType {
  // shortcut: keyed on the line, so "Today"/"Tomorrow" labels go stale past midnight until the line changes or the note reopens.
  constructor(readonly key: string, readonly details: TaskDetails, readonly status: string) {
    super();
  }

  eq(other: TaskBadgesWidget): boolean {
    return other.key === this.key;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-wys-task-badges";
    const services = view.state.facet(taskBadgeServices);
    if (!services) return el;
    const task = () => {
      const line = view.state.doc.lineAt(view.posAtDOM(el));
      return { line, task: tasksIn(view.state, line.from, line.to)[0] };
    };
    const editLine = services.editLine?.();
    services.render(el, this.details, /[xX-]/.test(this.status), {
      status: this.status,
      setStatus: (status) => {
        const { task: t } = task();
        if (t && t.status !== status) view.dispatch({ changes: { from: t.statusAt, to: t.statusAt + 1, insert: status }, userEvent: "plainsight.badge" });
      },
      change: (edit) => {
        const { task: t } = task();
        if (!t) return;
        const text = view.state.doc.sliceString(t.from, t.to);
        const next = edit(text);
        if (next !== text) view.dispatch({ changes: { from: t.from, to: t.to, insert: next }, userEvent: "plainsight.badge" });
      },
      inTasks: editLine
        ? () => {
            const { line } = task();
            const before = line.text;
            void editLine(before).then((after) => {
              // Only if the line is still what Tasks was given.
              if (after === before || view.state.doc.sliceString(line.from, line.to) !== before) return;
              view.dispatch({ changes: { from: line.from, to: line.to, insert: after }, userEvent: "plainsight.badge" });
            });
          }
        : undefined,
    });
    if (!el.childElementCount) el.classList.add("is-empty");
    if (/[xX-]/.test(this.status)) el.classList.add("is-closed");
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function taskFieldExtensions() {
  return [typingAt, guardFields, caretBeforeFields, enterPastFields];
}
