import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { inlineMarksIn } from "../editor/syntax";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

describe("inlineMarksIn", () => {
  test("finds strong emphasis with delimiter ranges", () => {
    const s = mkState("hello **world**");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks).toEqual([
      {
        type: "strong",
        from: 6,
        to: 15,
        delims: [
          { from: 6, to: 8 },
          { from: 13, to: 15 },
        ],
      },
    ]);
  });

  test("finds emphasis and inline code", () => {
    const s = mkState("*a* and `b`");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks.map((m) => m.type)).toEqual(["em", "code"]);
    expect(marks[1].delims).toEqual([
      { from: 8, to: 9 },
      { from: 10, to: 11 },
    ]);
  });

  test("handles nested strong inside emphasis", () => {
    const s = mkState("*a **b** c*");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks.map((m) => m.type).sort()).toEqual(["em", "strong"]);
  });

  test("respects the range filter", () => {
    const s = mkState("**a**\n\nplain\n\n**b**");
    const marks = inlineMarksIn(s, 6, 13);
    expect(marks).toEqual([]);
  });

  test("ignores unsupported syntax", () => {
    const s = mkState("~~strike~~ and | table | ish |");
    // strikethrough is out of scope for M2; nothing should be returned
    expect(inlineMarksIn(mkState("~~x~~"), 0, 5)).toEqual([]);
    expect(inlineMarksIn(s, 0, s.doc.length)).toEqual([]);
  });
});
