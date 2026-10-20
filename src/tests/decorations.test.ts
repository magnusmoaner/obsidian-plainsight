import { describe, expect, test } from "vitest";
import { EditorState, RangeSet } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { markdownTree } from "../editor/parser";
import { buildDecorations } from "../editor/decorations";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

function ranges(set: RangeSet<Decoration>): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  set.between(0, 1e9, (from, to, value) => {
    out.push([from, to, value.spec.class ?? "replace"]);
  });
  // between() doesn't formally guarantee sorted visit order across chunks.
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe("buildDecorations", () => {
  test("hides strong delimiters and styles content", () => {
    const s = mkState("hello **world**");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [6, 8, "replace"],
      [13, 15, "replace"],
    ]);
    expect(ranges(decorations)).toContainEqual([6, 15, "cm-wys-strong"]);
  });

  test("styles inline code", () => {
    const s = mkState("run `ls` now");
    const { decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(decorations)).toContainEqual([4, 8, "cm-wys-code"]);
  });

  test("plain text produces no decorations", () => {
    const s = mkState("nothing fancy here");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([]);
    expect(ranges(decorations)).toEqual([]);
  });

  test("nested constructs build without throwing", () => {
    // *a **b** c* — Emphasis wrapping a StrongEmphasis: mark and replace
    // decorations coincide at the same positions.
    const s = mkState("*a **b** c*");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [0, 1, "replace"],
      [3, 5, "replace"],
      [6, 8, "replace"],
      [10, 11, "replace"],
    ]);
    const marks = ranges(decorations).filter(([, , cls]) => cls !== "replace");
    expect(marks).toEqual([
      [0, 11, "cm-wys-em"],
      [3, 8, "cm-wys-strong"],
    ]);
  });

  test("touching delimiter spans are coalesced into one atomic range", () => {
    // ***x*** — em delims [0,1]/[6,7] touch strong delims [1,3]/[4,6].
    // skipAtomicRanges only relocates positions strictly inside a range, so
    // a junction like pos 1 would be a dead cursor stop unless merged.
    const s = mkState("***x***");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [0, 3, "replace"],
      [4, 7, "replace"],
    ]);
    const marks = ranges(decorations).filter(([, , cls]) => cls !== "replace");
    expect(marks).toEqual([
      [0, 7, "cm-wys-em"],
      [1, 6, "cm-wys-strong"],
    ]);
  });

  test("constructs straddling the window are dropped entirely", () => {
    // Window contract Task 5 depends on: [0, 8] cuts through the first
    // strong construct (3..9), so nothing is emitted for it.
    const s = mkState("aa **bb** cc **dd**");
    const { hidden, decorations } = buildDecorations(s, 0, 8);
    expect(ranges(hidden)).toEqual([]);
    expect(ranges(decorations)).toEqual([]);
  });
});

describe("buildDecorations on headings", () => {
  test("hides the marker and styles the line", () => {
    const s = mkState("## Title");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([[0, 3, "replace"]]);
    expect(ranges(decorations)).toContainEqual([
      0,
      0,
      "cm-wys-heading cm-wys-h2",
    ]);
  });

  test("line decoration anchors to the heading's own line, not the window", () => {
    const s = mkState("para\n\n# Later");
    const { decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(decorations)).toContainEqual([
      6,
      6,
      "cm-wys-heading cm-wys-h1",
    ]);
  });

  test("hides a closing sequence too", () => {
    const s = mkState("# Closed #");
    expect(ranges(buildDecorations(s, 0, s.doc.length).hidden)).toEqual([
      [0, 2, "replace"],
      [8, 10, "replace"],
    ]);
  });

  test("inline marks inside a heading still render", () => {
    const s = mkState("# a **b**");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [0, 2, "replace"],
      [4, 6, "replace"],
      [7, 9, "replace"],
    ]);
    expect(ranges(decorations)).toContainEqual([4, 9, "cm-wys-strong"]);
  });

  test("a bare # is not decorated", () => {
    const s = mkState("#");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([]);
    expect(ranges(decorations)).toEqual([]);
  });
});

describe("buildDecorations on callouts", () => {
  test("hides every quote mark and replaces the type token", () => {
    const s = mkState("> [!quote] Title\n> body");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    // Quote marks hidden; the token range is atomic but rendered by the widget.
    expect(ranges(hidden)).toEqual([
      [0, 2, "replace"],
      [2, 11, "replace"],
      [17, 19, "replace"],
    ]);
    // Exactly one decoration over the token — the widget, not a plain hide.
    const overToken = ranges(decorations).filter(
      ([f, t]) => f === 2 && t === 11
    );
    expect(overToken).toHaveLength(1);
  });

  test("puts a box line decoration on every line, ends marked", () => {
    const s = mkState("> [!info] T\n> a\n> b");
    const classes = ranges(buildDecorations(s, 0, s.doc.length).decorations)
      .filter(([, , c]) => c.startsWith("cm-wys-callout"))
      .map(([f, , c]) => [f, c]);
    expect(classes).toEqual([
      [0, "cm-wys-callout cm-wys-callout-info cm-wys-callout-first"],
      [12, "cm-wys-callout cm-wys-callout-info"],
      [16, "cm-wys-callout cm-wys-callout-info cm-wys-callout-last"],
    ]);
  });

  test("a single-line callout is both first and last", () => {
    const s = mkState("> [!tip] Only");
    const classes = ranges(buildDecorations(s, 0, s.doc.length).decorations)
      .filter(([, , c]) => c.startsWith("cm-wys-callout"))
      .map(([, , c]) => c);
    expect(classes).toEqual([
      "cm-wys-callout cm-wys-callout-tip cm-wys-callout-first cm-wys-callout-last",
    ]);
  });

  test("plain blockquotes are left completely alone", () => {
    const s = mkState("> just a quote\n> more");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([]);
    expect(ranges(decorations)).toEqual([]);
  });

  test("inline marks inside a callout body still render", () => {
    const s = mkState("> [!note] T\n> a **b**");
    const { decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(decorations)).toContainEqual([16, 21, "cm-wys-strong"]);
  });
});

describe("buildDecorations on links", () => {
  test("markdown link: syntax hidden, text styled", () => {
    const s = mkState("see [text](https://x.dk) end");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [4, 5, "replace"],
      [9, 24, "replace"],
    ]);
    expect(ranges(decorations)).toContainEqual([5, 9, "cm-wys-link is-external"]);
  });

  test("unaliased wikilink: one atomic widget over the whole link", () => {
    const s = mkState("a [[Note]] b");
    const { hidden } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([[2, 10, "replace"]]);
  });

  test("bold inside link text still renders", () => {
    const s = mkState("[**b**](u)");
    const { decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(decorations)).toContainEqual([1, 6, "cm-wys-strong"]);
  });

  test("[foo] without a URL is left alone", () => {
    const s = mkState("[foo] bar");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([]);
    expect(ranges(decorations)).toEqual([]);
  });
});
