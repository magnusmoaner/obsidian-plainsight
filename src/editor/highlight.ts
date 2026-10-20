import type { MarkdownConfig } from "@lezer/markdown";

/*
 * `==highlight==` for @lezer/markdown, which doesn't have it. Built the way
 * the GFM extension builds `~~strikethrough~~`: a two-character delimiter
 * that can open when followed by a non-space and close when preceded by
 * one, so "a == b" and "===" stay plain text. Nodes: Highlight, with a
 * HighlightMark for each `==`.
 */

const EQUALS = 61;
const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1‐-‧]/;
const delimiter = { resolve: "Highlight", mark: "HighlightMark" };

export const Highlight: MarkdownConfig = {
  defineNodes: [{ name: "Highlight" }, { name: "HighlightMark" }],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1;
        if (pos > cx.offset && cx.char(pos - 1) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = Punctuation.test(before);
        const punctAfter = Punctuation.test(after);
        return cx.addDelimiter(
          delimiter,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter)
        );
      },
      after: "Emphasis",
    },
  ],
};
