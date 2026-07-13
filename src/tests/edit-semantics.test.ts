import { describe, expect, test } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { backspaceSpec } from "../editor/edit-semantics";

function mkState(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdownTree],
  });
}

function apply(doc: string, cursor: number): string | null {
  const s = mkState(doc, cursor);
  const spec = backspaceSpec(s);
  if (!spec) return null;
  return s.update(spec).state.doc.toString();
}

describe("backspaceSpec", () => {
  test("backspace right after a strong span unformats it", () => {
    // "hi **bold**" cursor at end (11)
    expect(apply("hi **bold**", 11)).toBe("hi bold");
  });

  test("backspace right after inline code unformats it", () => {
    expect(apply("x `code`", 8)).toBe("x code");
  });

  test("backspace right after nested strong unformats only the strong", () => {
    // "*a **b** c*" cursor at 8 (right after strong's closing **)
    expect(apply("*a **b** c*", 8)).toBe("*a b c*");
  });

  test("backspace on last content char removes whole construct", () => {
    // "**b**" cursor after b (3)
    expect(apply("**b**", 3)).toBe("");
  });

  test("ordinary backspace inside content falls through", () => {
    expect(apply("**bold**", 5)).toBeNull();
  });

  test("plain text falls through", () => {
    expect(apply("hello", 5)).toBeNull();
  });

  test("start of document falls through", () => {
    expect(apply("**a**", 0)).toBeNull();
  });

  test("non-empty selection falls through", () => {
    const s = EditorState.create({
      doc: "hi **bold**",
      selection: EditorSelection.single(3, 11),
      extensions: [markdownTree],
    });
    expect(backspaceSpec(s)).toBeNull();
  });
});
