import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import {
  calloutsIn,
  enclosingCallout,
  enclosingHeading,
  headingsIn,
  inlineMarksIn,
} from "../editor/syntax";

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

describe("headingsIn", () => {
  test("reports level, content start and the hidden opening marker", () => {
    const s = mkState("## Title");
    expect(headingsIn(s, 0, s.doc.length)).toEqual([
      {
        level: 2,
        from: 0,
        to: 8,
        contentFrom: 3,
        delims: [{ from: 0, to: 3 }],
      },
    ]);
  });

  test("hides every space between the marker and the text", () => {
    const s = mkState("###   Spaced");
    expect(headingsIn(s, 0, s.doc.length)[0]).toMatchObject({
      level: 3,
      contentFrom: 6,
      delims: [{ from: 0, to: 6 }],
    });
  });

  test("hides a closing sequence together with the space before it", () => {
    const s = mkState("## Closed ##");
    expect(headingsIn(s, 0, s.doc.length)[0].delims).toEqual([
      { from: 0, to: 3 },
      { from: 9, to: 12 },
    ]);
  });

  test("an emptied heading keeps its hidden marker", () => {
    const s = mkState("# ");
    expect(headingsIn(s, 0, s.doc.length)[0]).toMatchObject({
      level: 1,
      contentFrom: 2,
      delims: [{ from: 0, to: 2 }],
    });
  });

  test("a bare # with no space is not yet a heading", () => {
    // Lezer already calls this ATXHeading1. Hiding it would blank the
    // character mid-keystroke and flash it back on the next one.
    expect(headingsIn(mkState("#"), 0, 1)).toEqual([]);
    expect(headingsIn(mkState("#NoSpace"), 0, 8)).toEqual([]);
  });

  test("setext headings are left alone", () => {
    const s = mkState("Title\n=====");
    expect(headingsIn(s, 0, s.doc.length)).toEqual([]);
  });

  test("finds every heading in a multi-line document", () => {
    const s = mkState("# One\n\ntext\n\n### Three");
    expect(headingsIn(s, 0, s.doc.length).map((h) => h.level)).toEqual([1, 3]);
  });

  test("drops headings straddling the window", () => {
    const s = mkState("# Heading\n\npara");
    expect(headingsIn(s, 0, 5)).toEqual([]);
  });
});

describe("enclosingHeading", () => {
  test("found from inside the text", () => {
    expect(enclosingHeading(mkState("## Title"), 5)?.level).toBe(2);
  });

  test("found at the content start and at the line end", () => {
    const s = mkState("## Title");
    expect(enclosingHeading(s, 3)?.contentFrom).toBe(3);
    expect(enclosingHeading(s, 8)?.level).toBe(2);
  });

  test("found on a heading that is not the first line", () => {
    const s = mkState("para\n\n# Later");
    expect(enclosingHeading(s, 8)?.level).toBe(1);
  });

  test("null inside a paragraph", () => {
    expect(enclosingHeading(mkState("just text"), 4)).toBeNull();
  });
});

describe("calloutsIn", () => {
  test("detects type, token range and per-line quote marks", () => {
    const s = mkState("> [!quote] Title\n> body");
    expect(calloutsIn(s, 0, s.doc.length)).toEqual([
      {
        type: "quote",
        from: 0,
        to: 23,
        tokenFrom: 2,
        titleFrom: 11,
        quoteMarks: [
          { from: 0, to: 2 },
          { from: 17, to: 19 },
        ],
      },
    ]);
  });

  test("lowercases the type", () => {
    const s = mkState("> [!WARNING] T");
    expect(calloutsIn(s, 0, s.doc.length)[0].type).toBe("warning");
  });

  test("a plain blockquote is not a callout", () => {
    expect(calloutsIn(mkState("> just a quote"), 0, 14)).toEqual([]);
  });

  test("a quote whose text merely contains a link is not a callout", () => {
    const s = mkState("> see [!not-a-callout] here");
    expect(calloutsIn(s, 0, s.doc.length)).toEqual([]);
  });

  test("a titleless callout still reports a title position", () => {
    const s = mkState("> [!note]\n> body");
    expect(calloutsIn(s, 0, s.doc.length)[0]).toMatchObject({
      type: "note",
      tokenFrom: 2,
      titleFrom: 9,
    });
  });

  test("finds several callouts and drops ones straddling the window", () => {
    const s = mkState("> [!tip] A\n\n> [!note] B");
    expect(calloutsIn(s, 0, s.doc.length).map((c) => c.type)).toEqual([
      "tip",
      "note",
    ]);
    expect(calloutsIn(s, 0, 5)).toEqual([]);
  });
});

describe("enclosingCallout", () => {
  test("found from the body of the callout", () => {
    const s = mkState("> [!quote] Title\n> body");
    expect(enclosingCallout(s, 21)?.type).toBe("quote");
  });

  test("null outside any callout", () => {
    const s = mkState("> [!quote] T\n\nafter");
    expect(enclosingCallout(s, 16)).toBeNull();
  });
});
