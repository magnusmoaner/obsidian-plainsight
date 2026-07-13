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
