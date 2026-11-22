import { describe, expect, test } from "vitest";
import { isPlainlist, parsePlainlist } from "../../sidebar/core/plainlist";

const FILE = [
  "---",
  "plainlist: true",
  "---",
  "# Inbox",
  "- [ ] Water the plants [date:: 2026-11-23]",
  "## Home",
  "- [ ] Not an area: an Inbox heading",
  "# Projects",
  "- [ ] [[Garden plan]]",
  "## Home",
  "- [ ] [[Kitchen renovation|Kitchen]]",
  "- [x] [[Bike service]] [done:: 2026-11-01]",
  "## Work",
  "- [ ] [Q4 roadmap](Work/Q4%20roadmap.md)",
  "## Errands",
  "- [ ] Buy stamps",
  "```",
  "- [ ] [[Not a project]]",
  "```",
  "# Notes",
  "- [ ] [[Not a project either]]",
].join("\n");

describe("parsePlainlist", () => {
  test("finds projects, their areas and whether they're done", () => {
    const { projects, areas } = parsePlainlist(FILE);
    expect(areas).toEqual(["Home", "Work"]);
    expect(projects).toEqual([
      { link: "Garden plan", done: false, area: null, line: 8 },
      { link: "Kitchen renovation", done: false, area: "Home", line: 10 },
      { link: "Bike service", done: true, area: "Home", line: 11 },
      { link: "Work/Q4 roadmap", done: false, area: "Work", line: 13 },
    ]);
  });

  test("is marked by plainlist: true", () => {
    expect(isPlainlist({ plainlist: true })).toBe(true);
    expect(isPlainlist({ plainlist: "true" })).toBe(true);
    expect(isPlainlist({ plainlist: false })).toBe(false);
    expect(isPlainlist(null)).toBe(false);
  });
});
