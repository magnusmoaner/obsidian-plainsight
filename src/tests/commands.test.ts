import { describe, expect, test } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { setHeadingSpec, toggleInlineSpec } from "../editor/commands";

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

function heading(state: EditorState, level: number): string | null {
  const spec = setHeadingSpec(state, level);
  if (!spec) return null;
  return state.update(spec).state.doc.toString();
}

describe("setHeadingSpec", () => {
  test("converts a paragraph line into a heading", () => {
    expect(heading(mkState("Title", 3), 2)).toBe("## Title");
  });

  test("changes the level of an existing heading, keeping the space", () => {
    expect(heading(mkState("## Title", 5), 4)).toBe("#### Title");
  });

  test("re-applying the current level toggles back to a paragraph", () => {
    expect(heading(mkState("## Title", 5), 2)).toBe("Title");
  });

  test("level 0 removes the heading", () => {
    expect(heading(mkState("### Title", 6), 0)).toBe("Title");
  });

  test("level 0 on a paragraph is a no-op", () => {
    expect(heading(mkState("Title", 3), 0)).toBeNull();
  });

  test("removes a closing sequence along with the opener", () => {
    expect(heading(mkState("## Title ##", 5), 0)).toBe("Title");
  });

  test("converts an empty line", () => {
    expect(heading(mkState("a\n\nb", 2), 1)).toBe("a\n# \nb");
  });

  test("applies to every line the selection touches", () => {
    expect(heading(mkState("one\ntwo", 1, 5), 3)).toBe("### one\n### two");
  });

  test("leaves list and quote lines untouched", () => {
    // Prefixing `# ` inside these produces garbage Markdown; boring failure
    // until M4/M5 teach the command about block containers.
    expect(heading(mkState("- item", 3), 1)).toBeNull();
    expect(heading(mkState("> quoted", 4), 1)).toBeNull();
  });

  test("changes the level of an indented heading", () => {
    // Up to three leading spaces are legal before the marker; the `#`s start
    // at the node position, not the line start.
    expect(heading(mkState("   ## Title", 8), 1)).toBe("   # Title");
  });

  test("leaves the caret in the text, past the inserted marker", () => {
    const s = mkState("Title", 0);
    const after = s.update(setHeadingSpec(s, 2)!).state;
    // Caret must land at 3 (start of "Title"), not 0 — typing at 0 would put
    // characters in front of the `#` and break the heading.
    expect(after.selection.main.head).toBe(3);
  });

  test("preserves the caret's position within the text", () => {
    const s = mkState("Title", 3);
    const after = s.update(setHeadingSpec(s, 1)!).state;
    expect(after.selection.main.head).toBe(5);
  });
});
