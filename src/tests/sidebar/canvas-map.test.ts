import { describe, expect, test } from "vitest";
import { edgeEnds, wrapLabel } from "../../sidebar/core/canvas-map";

describe("wrapLabel", () => {
  test("breaks between words, and ends in … when it runs out of lines", () => {
    expect(wrapLabel("Lisbon in spring, Porto after", 10, 3)).toEqual(["Lisbon in", "spring,", "Porto…"]);
    expect(wrapLabel("Lisbon in spring", 10, 1)).toEqual(["Lisbon in…"]);
    expect(wrapLabel("Short", 10, 2)).toEqual(["Short"]);
  });

  test("cuts a word longer than a line", () => {
    expect(wrapLabel("Supercalifragilistic", 8, 2)).toEqual(["Superca…"]);
  });

  test("nothing when there's no room", () => {
    expect(wrapLabel("Text", 0, 2)).toEqual([]);
  });
});

describe("edgeEnds", () => {
  test("a line between two boxes starts and ends at their sides", () => {
    // Side by side: from a's right side to b's left side, at mid-height.
    expect(edgeEnds({ x: 0, y: 0, w: 100, h: 50 }, { x: 200, y: 0, w: 100, h: 50 })).toEqual([100, 25, 200, 25]);
    // One above the other: bottom to top.
    expect(edgeEnds({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 150, w: 100, h: 50 })).toEqual([50, 50, 50, 150]);
  });
});
