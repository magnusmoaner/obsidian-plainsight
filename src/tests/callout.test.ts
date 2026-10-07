import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownTree } from "../editor/parser";
import { setCalloutTypeSpec } from "../editor/callout";

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownTree] });
}

function retype(doc: string, pos: number, type: string): string | null {
  const s = mkState(doc);
  const spec = setCalloutTypeSpec(s, pos, type);
  if (!spec) return null;
  return s.update(spec).state.doc.toString();
}

describe("setCalloutTypeSpec", () => {
  test("rewrites the type, leaving title and body untouched", () => {
    expect(retype("> [!quote] Title\n> body", 5, "warning")).toBe(
      "> [!warning] Title\n> body"
    );
  });

  test("handles a longer type shrinking to a shorter one", () => {
    expect(retype("> [!important] T", 5, "tip")).toBe("> [!tip] T");
  });

  test("works from a position in the body, not just the title", () => {
    expect(retype("> [!quote] T\n> body here", 20, "note")).toBe(
      "> [!note] T\n> body here"
    );
  });

  test("selecting the current type is a no-op", () => {
    expect(retype("> [!quote] T", 5, "quote")).toBeNull();
  });

  test("does nothing outside a callout", () => {
    expect(retype("> plain quote", 5, "note")).toBeNull();
    expect(retype("just text", 3, "note")).toBeNull();
  });
});
