import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { wysiwyg } from "../editor/extension";
import { hiddenFields, tasksIn } from "../editor/tasks";

const doc = "- [ ] Buy milk ⏫ 📅 2026-11-20\n- [ ] Next";
const make = (text = doc) => EditorState.create({ doc: text, extensions: [wysiwyg()] });
const afterText = doc.indexOf(" ⏫");
const lineEnd = doc.indexOf("\n");

describe("task fields in the editor", () => {
  test("finds the task's text and hides its fields", () => {
    const s = make();
    const [task] = tasksIn(s, 0, lineEnd);
    expect(s.doc.sliceString(task.from, task.to)).toBe("Buy milk ⏫ 📅 2026-11-20");
    expect(hiddenFields(s, task)).toEqual([{ from: afterText, to: lineEnd }]);
  });

  test("tasks with Tasks' other statuses are found too", () => {
    const s = make("- [/] Paint ⏫\n- [-] Sand 📅 2026-11-20\n> - [ ] Quote 🔽");
    expect(tasksIn(s, 0, s.doc.length).map((t) => [t.status, s.doc.sliceString(t.from, t.to)])).toEqual([
      ["/", "Paint ⏫"],
      ["-", "Sand 📅 2026-11-20"],
      [" ", "Quote 🔽"],
    ]);
  });

  test("a task in a code block is left alone", () => {
    const s = make("```\n- [ ] Buy milk ⏫\n```");
    expect(tasksIn(s, 0, s.doc.length)).toEqual([]);
  });

  test("Delete after the text never removes the fields", () => {
    const s = make().update({ changes: { from: afterText, to: lineEnd }, userEvent: "delete.forward" }).state;
    expect(s.doc.toString()).toBe(doc);
  });

  test("deleting text and fields together keeps the fields", () => {
    const from = doc.indexOf("milk");
    const s = make().update({ changes: { from, to: lineEnd }, userEvent: "delete.selection" }).state;
    expect(s.doc.line(1).text).toBe("- [ ] Buy  ⏫ 📅 2026-11-20");
  });

  test("deleting the whole line takes the fields with it", () => {
    const s = make().update({ changes: { from: 0, to: lineEnd + 1 }, userEvent: "delete.selection" }).state;
    expect(s.doc.toString()).toBe("- [ ] Next");
  });

  test("the caret never rests after the fields", () => {
    const s = make().update({ selection: EditorSelection.cursor(lineEnd) }).state;
    expect(s.selection.main.head).toBe(afterText);
  });

  test("a tag being typed stays text until the caret moves on", () => {
    let s = make("- [ ] Buy milk");
    const end = s.doc.length;
    s = s.update({ changes: { from: end, insert: " #shop" }, selection: EditorSelection.cursor(end + 6), userEvent: "input.type" }).state;
    const [task] = tasksIn(s, 0, s.doc.length);
    expect(hiddenFields(s, task)).toEqual([]);
    expect(s.selection.main.head).toBe(end + 6);
    s = s.update({ selection: EditorSelection.cursor(0) }).state;
    expect(hiddenFields(s, task)).toEqual([{ from: end, to: end + 6 }]);
  });

  test("a space typed after the text stays, with the caret after it", () => {
    let s = make();
    s = s.update({ changes: { from: afterText, insert: " " }, selection: EditorSelection.cursor(afterText + 1), userEvent: "input.type" }).state;
    const [task] = tasksIn(s, 0, s.doc.line(1).to);
    expect(hiddenFields(s, task)[0].from).toBe(afterText + 1);
    expect(s.selection.main.head).toBe(afterText + 1);
  });

  test("the caret never rests inside hidden fields", () => {
    const text = "- [ ] Buy milk    ⏫ 📅 2026-11-20";
    const end = text.indexOf("milk") + 4;
    const s = make(text).update({ selection: EditorSelection.cursor(end + 2) }).state;
    expect(s.selection.main.head).toBe(end);
  });

  test("a badge's own change goes through", () => {
    const s = make().update({ changes: { from: afterText, to: lineEnd, insert: " 🔽 📅 2026-11-20" }, userEvent: "plainsight.badge" }).state;
    expect(s.doc.line(1).text).toBe("- [ ] Buy milk 🔽 📅 2026-11-20");
  });
});
