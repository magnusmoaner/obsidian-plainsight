import { describe, expect, test } from "vitest";
import { addTag, appendLine, folderNameError, normalizeTag } from "../../sidebar/core/edits";

describe("normalizeTag", () => {
  test("strips #, spaces at the ends and stray slashes", () => {
    expect(normalizeTag("  #Work/Client/ ")).toBe("Work/Client");
  });
  test("rejects empty, spaced, purely numeric or punctuation tags", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("two words")).toBeNull();
    expect(normalizeTag("2026")).toBeNull();
    expect(normalizeTag("a,b")).toBeNull();
  });
  test("allows unicode, digits, - _ and nesting", () => {
    expect(normalizeTag("sag-2026_ø/år")).toBe("sag-2026_ø/år");
  });
  test("allows combining marks and emoji, as Obsidian does", () => {
    expect(normalizeTag("e\u0301tude")).toBe("e\u0301tude");
    expect(normalizeTag("हिन्दी")).toBe("हिन्दी");
    expect(normalizeTag("🚀launch")).toBe("🚀launch");
  });
});

describe("addTag", () => {
  test("adds a tags list when the note has no frontmatter", () => {
    expect(addTag("Body", "work")).toBe("---\ntags:\n  - work\n---\nBody");
  });

  test("adds a tags key to existing frontmatter, keeping other lines", () => {
    expect(addTag("---\ntitle: 'Q' # c\n---\nBody", "work")).toBe(
      "---\ntitle: 'Q' # c\ntags:\n  - work\n---\nBody"
    );
  });

  test("appends to a block list, matching its indentation", () => {
    expect(addTag("---\ntags:\n    - a\n    - b\nx: 1\n---\nB", "work")).toBe(
      "---\ntags:\n    - a\n    - b\n    - work\nx: 1\n---\nB"
    );
  });

  test("appends to an inline list", () => {
    expect(addTag("---\ntags: [a, b]\n---\nB", "work")).toBe("---\ntags: [a, b, work]\n---\nB");
    expect(addTag("---\ntags: []\n---\nB", "work")).toBe("---\ntags: [work]\n---\nB");
  });

  test("turns a scalar into an inline list", () => {
    expect(addTag("---\ntags: a\n---\nB", "work")).toBe("---\ntags: [a, work]\n---\nB");
  });

  test("an empty tags key becomes a list", () => {
    expect(addTag("---\ntags:\nx: 1\n---\nB", "work")).toBe("---\ntags:\n  - work\nx: 1\n---\nB");
  });

  test("no change when the tag is already there, case and # ignored", () => {
    for (const text of [
      "---\ntags: [Work]\n---\nB",
      "---\ntags:\n  - \"#work\"\n---\nB",
      "---\ntags: work\n---\nB",
    ]) {
      expect(addTag(text, "work")).toBe(text);
    }
  });

  test("keeps CRLF line endings", () => {
    expect(addTag("---\r\na: 1\r\n---\r\nB", "work")).toBe("---\r\na: 1\r\ntags:\r\n  - work\r\n---\r\nB");
  });
});

describe("appendLine", () => {
  test("adds on its own line, whatever the file ends with", () => {
    expect(appendLine("a", "- [ ] t")).toBe("a\n- [ ] t\n");
    expect(appendLine("a\n", "- [ ] t")).toBe("a\n- [ ] t\n");
    expect(appendLine("", "- [ ] t")).toBe("- [ ] t\n");
  });
  test("keeps CRLF files CRLF", () => {
    expect(appendLine("a\r\n", "- [ ] t")).toBe("a\r\n- [ ] t\r\n");
  });
});

describe("folderNameError", () => {
  test("accepts ordinary names, including Danish letters", () => {
    expect(folderNameError("Økonomi & bolig")).toBeNull();
  });
  test("rejects empty, reserved characters and leading dots", () => {
    expect(folderNameError("  ")).not.toBeNull();
    expect(folderNameError("a/b")).not.toBeNull();
    expect(folderNameError("a:b")).not.toBeNull();
    expect(folderNameError(".hidden")).not.toBeNull();
  });
});

describe("addTag: shapes it edits", () => {
  test("a zero-indent block list keeps its zero indent", () => {
    expect(addTag("---\ntags:\n- a\n- b\ntitle: x\n---\nB", "new")).toBe(
      "---\ntags:\n- a\n- b\n- new\ntitle: x\n---\nB"
    );
  });

  test("Tags: and tag: keys are used, not duplicated", () => {
    expect(addTag("---\nTags:\n  - a\n---\nB", "new")).toBe("---\nTags:\n  - a\n  - new\n---\nB");
    expect(addTag("---\ntag: a\n---\nB", "new")).toBe("---\ntag: [a, new]\n---\nB");
  });

  test("a byte-order mark doesn't cause a second frontmatter block", () => {
    expect(addTag("\uFEFF---\ntitle: x\n---\nB", "new")).toBe(
      "\uFEFF---\ntitle: x\ntags:\n  - new\n---\nB"
    );
  });

  test("a top-level comment after the list is left alone", () => {
    expect(addTag("---\ntags:\n  - a\n# about x\nx: 1\n---\nB", "new")).toBe(
      "---\ntags:\n  - a\n  - new\n# about x\nx: 1\n---\nB"
    );
  });

  test("quoted block items are compared without their quotes", () => {
    const text = "---\ntags:\n  - 'new'\n---\nB";
    expect(addTag(text, "new")).toBe(text);
  });
});

describe("addTag: shapes it refuses (null) rather than risk breaking YAML", () => {
  const refuses = [
    ["a trailing comment on a flow list", "---\ntags: [a] # x\n---\nB"],
    ["a comment as the value", "---\ntags: # mine\n  - a\n---\nB"],
    ["a multi-line flow list", "---\ntags: [a,\n  b]\n---\nB"],
    ["a quoted comma inside a flow list", '---\ntags: ["a,b"]\n---\nB'],
    ["a comment line inside a block list", "---\ntags:\n  - a\n  # c\n  - b\n---\nB"],
    ["a blank line inside a block list", "---\ntags:\n  - a\n\n  - b\n---\nB"],
    ["mixed indents in a block list", "---\ntags:\n  - a\n    - b\n---\nB"],
    ["a comment after a block item", "---\ntags:\n  - a # why\n---\nB"],
    ["a space-separated string", "---\ntags: a b\n---\nB"],
    ["a comma-separated string", "---\ntags: a, b\n---\nB"],
    ["a quoted scalar", '---\ntags: "a"\n---\nB'],
    ["a nested map under tags", "---\ntags:\n  key: v\n---\nB"],
  ];
  for (const [name, text] of refuses) {
    test(name, () => {
      expect(addTag(text, "new")).toBeNull();
    });
  }
});
