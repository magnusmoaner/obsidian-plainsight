import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState, RangeSet } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { buildDecorations } from "../editor/decorations";
import { backspaceSpec, deleteForwardSpec } from "../editor/edit-semantics";
import { markdownTree } from "../editor/parser";
import { escapesIn, inlineMarksIn } from "../editor/syntax";

function mk(doc: string, cursor = 0): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(cursor), extensions: [markdownTree] });
}

function ranges(set: RangeSet<Decoration>): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  set.between(0, 1e9, (from, to, value) => {
    out.push([from, to, value.spec.class ?? "replace"]);
  });
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const backspace = (doc: string, cursor: number) => {
  const s = mk(doc, cursor);
  const spec = backspaceSpec(s);
  return spec ? s.update(spec).state.doc.toString() : null;
};
const deleteForward = (doc: string, cursor: number) => {
  const s = mk(doc, cursor);
  const spec = deleteForwardSpec(s);
  return spec ? s.update(spec).state.doc.toString() : null;
};

describe("highlight and strikethrough", () => {
  test("==text== is a highlight, with its == as delimiters", () => {
    const s = mk("a ==hi== b");
    expect(inlineMarksIn(s, 0, s.doc.length)).toEqual([
      { type: "highlight", from: 2, to: 8, delims: [{ from: 2, to: 4 }, { from: 6, to: 8 }] },
    ]);
  });

  test("not a highlight: three =, == between spaces, or unclosed", () => {
    for (const doc of ["a === b", "a == b == c", "==open"]) {
      expect(inlineMarksIn(mk(doc), 0, doc.length).filter((m) => m.type === "highlight")).toEqual([]);
    }
  });

  test("nests with bold", () => {
    const doc = "**==x==**";
    expect(inlineMarksIn(mk(doc), 0, doc.length).map((m) => m.type)).toEqual(["strong", "highlight"]);
  });

  test("a whole highlighted paragraph", () => {
    const doc = '==This template combines "what" and "why".==';
    const marks = inlineMarksIn(mk(doc), 0, doc.length);
    expect(marks.map((m) => [m.type, m.from, m.to])).toEqual([["highlight", 0, doc.length]]);
  });

  test("the == are hidden and the text styled", () => {
    const s = mk("a ==hi== b");
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [2, 4, "replace"],
      [6, 8, "replace"],
    ]);
    expect(ranges(decorations)).toContainEqual([2, 8, "cm-wys-highlight"]);
  });

  test("~~text~~ is struck through, its ~~ hidden", () => {
    const s = mk("a ~~old~~");
    expect(inlineMarksIn(s, 0, s.doc.length).map((m) => m.type)).toEqual(["strike"]);
    const { hidden, decorations } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [2, 4, "replace"],
      [7, 9, "replace"],
    ]);
    expect(ranges(decorations)).toContainEqual([2, 9, "cm-wys-strike"]);
  });

  test("Backspace right after a highlight removes the highlighting, as for bold", () => {
    expect(backspace("a ==hi==", 8)).toBe("a hi");
  });
});

describe("escapes", () => {
  test("the backslash of an escaped character is hidden", () => {
    const s = mk("\\[x\\]");
    expect(escapesIn(s, 0, s.doc.length)).toEqual([
      { from: 0, to: 1 },
      { from: 3, to: 4 },
    ]);
    const { hidden } = buildDecorations(s, 0, s.doc.length);
    expect(ranges(hidden)).toEqual([
      [0, 1, "replace"],
      [3, 4, "replace"],
    ]);
  });

  test("in a table the backslash stays: there \\| and | mean different things", () => {
    const doc = "| a | b |\n| - | - |\n| x \\| y | z |";
    expect(escapesIn(mk(doc), 0, doc.length)).toEqual([]);
  });

  test("in code a backslash is just a backslash", () => {
    expect(escapesIn(mk("`\\[`"), 0, 4)).toEqual([]);
  });

  test("Backspace after an escaped character removes it with its hidden backslash", () => {
    expect(backspace("a\\[b", 3)).toBe("ab");
  });

  test("Delete before an escaped character removes both too", () => {
    expect(deleteForward("a\\[b", 1)).toBe("ab");
    expect(deleteForward("ab", 1)).toBeNull();
  });
});
