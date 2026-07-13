import { describe, expect, test } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { toggleInlineSpec } from "../editor/commands";

function mkState(doc: string, anchor: number, head?: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head ?? anchor),
    extensions: [markdownTree],
  });
}

function apply(state: EditorState, type: "strong" | "em" | "code"): string | null {
  const spec = toggleInlineSpec(state, type);
  if (!spec) return null;
  return state.update(spec).state.doc.toString();
}

describe("toggleInlineSpec", () => {
  test("wraps a selection in strong delimiters", () => {
    expect(apply(mkState("hello world", 6, 11), "strong")).toBe("hello **world**");
  });

  test("wraps the word at an empty cursor", () => {
    expect(apply(mkState("hello world", 8), "em")).toBe("hello *world*");
  });

  test("unwraps when the cursor is inside a construct", () => {
    expect(apply(mkState("hello **world**", 10), "strong")).toBe("hello world");
  });

  test("unwraps when the selection covers the content", () => {
    expect(apply(mkState("say `ls -la` ok", 5, 11), "code")).toBe("say ls -la ok");
  });

  test("no-op on empty cursor in whitespace", () => {
    expect(apply(mkState("a  b", 2), "strong")).toBeNull();
  });

  test("toggling em inside strong wraps, not unwraps", () => {
    // Selection covers "hello" (offsets 2..7 inside the ** delimiters).
    expect(apply(mkState("**hello world**", 2, 7), "em")).toBe("***hello* world**");
  });

  test("wrap keeps the selection over the content", () => {
    const s = mkState("hello world", 6, 11);
    const spec = toggleInlineSpec(s, "strong");
    const after = s.update(spec!).state;
    expect(after.selection.main.from).toBe(8);
    expect(after.selection.main.to).toBe(13);
  });

  test("unwrap with cursor right after closing delimiter", () => {
    expect(apply(mkState("hi **bold**", 11), "strong")).toBe("hi bold");
  });

  test("wrap at document edges", () => {
    expect(apply(mkState("word", 0, 4), "strong")).toBe("**word**");
  });

  test("selection spanning a blank line wraps but stays raw text (v1)", () => {
    // Markdown does not parse strong emphasis across a blank line, so the
    // delimiters remain visible in the editor — a boring, non-destructive
    // failure mode we accept in v1.
    expect(apply(mkState("a\n\nb", 0, 4), "strong")).toBe("**a\n\nb**");
  });
});

describe("toggleInlineSpec on multi-line constructs (line-scoping regression)", () => {
  test("unwraps with a selection inside a multi-line strong", () => {
    expect(apply(mkState("**a\nb**", 2, 3), "strong")).toBe("a\nb");
  });

  test("unwraps with a cursor inside a multi-line strong", () => {
    expect(apply(mkState("**ab\ncd**", 3), "strong")).toBe("ab\ncd");
  });
});
