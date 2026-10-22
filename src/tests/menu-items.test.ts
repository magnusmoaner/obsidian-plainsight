import { describe, expect, test } from "vitest";
import {
  classifyMenuError,
  explainMenuFailure,
  menuCommandId,
  menuCommandName,
  menuPaths,
  parseMenuPaths,
  WRITING_TOOLS,
} from "../menu-items";

describe("parseMenuPaths", () => {
  test("one item per line, levels split on > › → or ->", () => {
    expect(parseMenuPaths("Window > Minimize\nView › Zoom In\nFile → Export -> PDF")).toEqual([
      ["Window", "Minimize"],
      ["View", "Zoom In"],
      ["File", "Export", "PDF"],
    ]);
  });

  test("blank lines and lines without an item are skipped", () => {
    expect(parseMenuPaths("\n  \nWindow\n > Minimize\nWindow >\n")).toEqual([]);
  });
});

describe("menuCommandId", () => {
  test("depends only on the path, so a hotkey stays bound", () => {
    expect(menuCommandId(["Edit", "Writing Tools", "Summarize"])).toBe("menu-edit-writing-tools-summarize");
    expect(menuCommandId(["Edit", "Writing Tools", "Compose…"])).toBe("menu-edit-writing-tools-compose");
    expect(menuCommandId(["Rediger", "Skrivehjælp", "Opsummér"])).toBe("menu-rediger-skrivehjælp-opsummér");
  });
});

describe("menuCommandName", () => {
  test("Writing Tools get a short name, other items their path", () => {
    expect(menuCommandName(["Edit", "Writing Tools", "Proofread"])).toBe("Writing Tools: Proofread");
    expect(menuCommandName(["Window", "Minimize"])).toBe("Window › Minimize");
  });
});

describe("menuPaths", () => {
  const off = { writingToolsCommands: false, writingTools: [...WRITING_TOOLS], menuCommands: "" };

  test("nothing until asked for", () => {
    expect(menuPaths(off)).toEqual([]);
  });

  test("the chosen Writing Tools, in menu order, then the other items", () => {
    const paths = menuPaths({
      writingToolsCommands: true,
      writingTools: ["Summarize", "Proofread", "Not a tool"],
      menuCommands: "Window > Minimize",
    });
    expect(paths).toEqual([
      ["Edit", "Writing Tools", "Proofread"],
      ["Edit", "Writing Tools", "Summarize"],
      ["Window", "Minimize"],
    ]);
  });

  test("Writing Tools are off as a whole when their switch is", () => {
    expect(menuPaths({ ...off, menuCommands: "Window > Minimize" })).toEqual([["Window", "Minimize"]]);
  });

  test("the same item twice becomes one command", () => {
    const paths = menuPaths({
      writingToolsCommands: true,
      writingTools: ["Summarize"],
      menuCommands: "Edit > Writing Tools > Summarize\nWindow > Minimize\nWindow › Minimize",
    });
    expect(paths).toEqual([
      ["Edit", "Writing Tools", "Summarize"],
      ["Window", "Minimize"],
    ]);
  });
});

describe("classifyMenuError", () => {
  test("osascript's errors", () => {
    expect(classifyMenuError("execution error: Not authorized to send Apple events to System Events. (-1743)")).toBe(
      "automation"
    );
    expect(classifyMenuError("System Events got an error: osascript is not allowed assistive access. (-25211)")).toBe(
      "accessibility"
    );
    expect(classifyMenuError("execution error: Greyed out (7001)")).toBe("disabled");
    expect(classifyMenuError("System Events got an error: Can’t get menu item \"Sumarize\". (-1728)")).toBe("missing");
    expect(classifyMenuError("System Events got an error: Application isn’t running. (-600)")).toBe("starting");
    expect(classifyMenuError("spawn osascript ENOENT")).toBe("other");
  });
});

describe("explainMenuFailure", () => {
  test("names the item and what to do", () => {
    const summarize = ["Edit", "Writing Tools", "Summarize"];
    expect(explainMenuFailure("disabled", summarize)).toBe(
      '"Edit › Writing Tools › Summarize" is greyed out right now. Select some text in a note first.'
    );
    expect(explainMenuFailure("missing", ["Window", "Minimise"])).toContain("in your Mac's language");
    expect(explainMenuFailure("accessibility", null)).toContain("Accessibility");
    expect(explainMenuFailure("other", null, "timed out")).toBe("Couldn't use the menu item: timed out");
  });
});
