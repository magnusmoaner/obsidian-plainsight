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

  // --- Pinning tests: document current lezer/GFM behavior that Tasks 4-7
  // depend on. If any of these break after a dependency bump, downstream
  // decoration and command logic must be revisited.

  test("pins adjacent-construct parsing: **a****b** is ONE strong node", () => {
    // Lezer parses this as a single StrongEmphasis spanning the whole string,
    // with only the outermost ** pairs as delimiters; the interior **** is
    // plain content. This diverges from CommonMark reference rendering
    // (<strong>a</strong><strong>b</strong>): delimiter-hiding will leave the
    // interior **** visible.
    const s = mkState("**a****b**");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks).toEqual([
      {
        type: "strong",
        from: 0,
        to: 10,
        delims: [
          { from: 0, to: 2 },
          { from: 8, to: 10 },
        ],
      },
    ]);
  });

  test("pins multi-line emphasis: *a\\nb* is one em spanning the newline", () => {
    const s = mkState("*a\nb*");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    expect(marks).toEqual([
      {
        type: "em",
        from: 0,
        to: 5,
        delims: [
          { from: 0, to: 1 },
          { from: 4, to: 5 },
        ],
      },
    ]);
  });

  test("pins straddling exclusion: a mark half-inside the window is dropped", () => {
    const s = mkState("x **str** y");
    // The strong node spans 2-9; a window ending at 6 cuts through it.
    expect(inlineMarksIn(s, 0, 6)).toEqual([]);
  });

  test("pins nested delimiter attribution: outer em owns only its own marks", () => {
    const s = mkState("*a **b** c*");
    const marks = inlineMarksIn(s, 0, s.doc.length);
    const em = marks.find((m) => m.type === "em");
    // The inner strong's ** delimiters are children of StrongEmphasis, not of
    // the outer Emphasis, so they must not be attributed to the em node.
    expect(em?.delims).toEqual([
      { from: 0, to: 1 },
      { from: 10, to: 11 },
    ]);
  });

  test("ignores unsupported syntax", () => {
    const s = mkState("~~strike~~ and | table | ish |");
    // strikethrough is out of scope for M2; nothing should be returned
    expect(inlineMarksIn(mkState("~~x~~"), 0, 5)).toEqual([]);
    expect(inlineMarksIn(s, 0, s.doc.length)).toEqual([]);
  });
});
