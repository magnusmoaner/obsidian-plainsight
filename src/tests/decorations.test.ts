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
  return out;
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
});
