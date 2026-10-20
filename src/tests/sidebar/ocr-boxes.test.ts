import { describe, expect, test } from "vitest";
import { ocrBoxes } from "../../sidebar/core/ocr-boxes";

// The shape OCR Extractor writes: the embed, a blank line, then a folded
// callout with the file's text. All content here is invented.
const note = [
  "Here is the receipt.",
  "",
  "📎 ![[receipt-0042.pdf]]",
  "",
  "> [!ocr-extractor]- Extracted text",
  "> Corner Shop",
  ">",
  "> Total 12.50",
  "",
  "Thanks",
].join("\n");

describe("ocrBoxes", () => {
  test("finds the box under an embed, with its file and text", () => {
    expect(ocrBoxes(note)).toEqual([{ link: "receipt-0042.pdf", text: "Corner Shop\n\nTotal 12.50", line: 4 }]);
  });

  test("an embed on its own line, aliased or sized", () => {
    const text = "![[Scan 1.pdf|300]]\n\n> [!ocr-extractor]- Extracted text\n> hello";
    expect(ocrBoxes(text).map((b) => [b.link, b.text])).toEqual([["Scan 1.pdf", "hello"]]);
  });

  test("several files, each with its own box", () => {
    const text = [
      "![[a.png]]",
      "",
      "> [!ocr-extractor]- Extracted text",
      "> first",
      "",
      "![[b.png]]",
      "",
      "> [!ocr-extractor]- Extracted text",
      "> second",
    ].join("\n");
    expect(ocrBoxes(text).map((b) => [b.link, b.text])).toEqual([
      ["a.png", "first"],
      ["b.png", "second"],
    ]);
  });

  test("inside a quote, the box is one level deeper", () => {
    const text = "> ![[a.png]]\n>\n> > [!ocr-extractor]- Extracted text\n> > quoted text\n> after";
    expect(ocrBoxes(text).map((b) => [b.link, b.text])).toEqual([["a.png", "quoted text"]]);
  });

  test("a markdown embed, with spaces encoded", () => {
    const text = "![](Scan%201.pdf)\n\n> [!ocr-extractor]- Extracted text\n> hi";
    expect(ocrBoxes(text).map((b) => b.link)).toEqual(["Scan 1.pdf"]);
  });

  test("the older summary form OCR Extractor still recognises", () => {
    const text = "![[a.png]]\n\n> [!summary]- Extracted text\n> old";
    expect(ocrBoxes(text).map((b) => b.text)).toEqual(["old"]);
  });

  test("a box with no embed above it belongs to no file", () => {
    expect(ocrBoxes("Some text\n\n> [!ocr-extractor]- Extracted text\n> orphan")).toEqual([]);
  });

  test("an ordinary callout under an embed is not a box", () => {
    expect(ocrBoxes("![[a.png]]\n\n> [!note] Mine\n> my words")).toEqual([]);
  });

  test("nothing inside code blocks", () => {
    const text = "```\n![[a.png]]\n\n> [!ocr-extractor]- Extracted text\n> x\n```";
    expect(ocrBoxes(text)).toEqual([]);
  });
});
