import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { wysiwyg } from "../editor/extension";
import { markdownTree, treeOf } from "../editor/parser";

describe("wysiwyg extension bundle", () => {
  test("includes the markdown parse field exactly once", () => {
    const s = EditorState.create({ doc: "**x**", extensions: [wysiwyg()] });
    expect(treeOf(s).length).toBe(5);
  });

  test("is safe to combine with an explicit markdownTree", () => {
    const s = EditorState.create({
      doc: "ok",
      extensions: [wysiwyg(), markdownTree],
    });
    expect(treeOf(s).length).toBe(2);
  });
});
