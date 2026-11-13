import { describe, expect, test } from "vitest";
import { addListItem, addTag, appendLine, folderNameError, markAsBoard, movedPath, normalizeTag, setTextProperty } from "../../sidebar/core/edits";

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
    expect(normalizeTag("tur-2026_ø/år")).toBe("tur-2026_ø/år");
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
    expect(folderNameError("Køkken & have")).toBeNull();
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

describe("addListItem", () => {
  const item = '"[[Garden plan]]"';

  test("a note without the property gets it, with or without frontmatter", () => {
    expect(addListItem("Body", "embedded-in", item)).toBe('---\nembedded-in:\n  - "[[Garden plan]]"\n---\nBody');
    expect(addListItem("---\nplainsight-plugin: board\n---\n\n## To do\n", "embedded-in", item)).toBe(
      '---\nplainsight-plugin: board\nembedded-in:\n  - "[[Garden plan]]"\n---\n\n## To do\n'
    );
  });

  test("a second note is added after the first, in the list's own indent; nothing else moves", () => {
    const text = '---\n# keep me\nembedded-in:\n    - "[[Trip]]"\ntitle: \'Q\'\n---\nB';
    expect(addListItem(text, "embedded-in", item)).toBe('---\n# keep me\nembedded-in:\n    - "[[Trip]]"\n    - "[[Garden plan]]"\ntitle: \'Q\'\n---\nB');
  });

  test("an item that is there already changes nothing", () => {
    const text = '---\nembedded-in:\n  - "[[Garden plan]]"\n---\nB';
    expect(addListItem(text, "embedded-in", item)).toBe(text);
  });

  test("a property in another shape is refused", () => {
    expect(addListItem('---\nembedded-in: "[[Trip]]"\n---\nB', "embedded-in", item)).toBeNull();
    expect(addListItem('---\nembedded-in: ["[[Trip]]"]\n---\nB', "embedded-in", item)).toBeNull();
    expect(addListItem("---\nembedded-in:\n  - a # note\n---\nB", "embedded-in", item)).toBeNull();
    expect(addListItem("---\nembedded-in:\n  nested: 1\n---\nB", "embedded-in", item)).toBeNull();
  });
});

describe("markAsBoard", () => {
  test("adds the board mark to a template's properties, once", () => {
    expect(markAsBoard("## Ideas\n")).toBe("---\nplainsight-plugin: board\n---\n## Ideas\n");
    expect(markAsBoard("---\ntags: [plan]\n---\n## Ideas\n")).toBe("---\ntags: [plan]\nplainsight-plugin: board\n---\n## Ideas\n");
    const marked = "---\nplainsight-plugin: board\n---\n## Ideas\n";
    expect(markAsBoard(marked)).toBe(marked);
  });
});

describe("setTextProperty", () => {
  test("sets, replaces and removes one line, leaving the rest as it was", () => {
    const text = "---\n# keep me\ntags: [home]\n---\nBody";
    const set = setTextProperty(text, "description", "New kitchen by Christmas");
    expect(set).toBe('---\n# keep me\ntags: [home]\ndescription: "New kitchen by Christmas"\n---\nBody');
    expect(setTextProperty(set!, "description", 'Say "hi": now')).toBe('---\n# keep me\ntags: [home]\ndescription: "Say \\"hi\\": now"\n---\nBody');
    expect(setTextProperty(set!, "description", "")).toBe(text);
  });

  test("a note without frontmatter gets one; clearing nothing changes nothing", () => {
    expect(setTextProperty("Body", "description", "Hello")).toBe('---\ndescription: "Hello"\n---\nBody');
    expect(setTextProperty("Body", "description", "")).toBe("Body");
  });

  test("line breaks become spaces: the property is one line", () => {
    expect(setTextProperty("Body", "description", "one\ntwo")).toBe('---\ndescription: "one two"\n---\nBody');
  });

  test("a description written over several lines is refused", () => {
    expect(setTextProperty("---\ndescription: |\n  long\n  text\n---\nB", "description", "x")).toBeNull();
    expect(setTextProperty("---\ndescription:\n  - a\n---\nB", "description", "x")).toBeNull();
    expect(setTextProperty("---\ndescription: first\n  and more\n---\nB", "description", "x")).toBeNull();
  });

  test("a property whose name only starts the same is not touched", () => {
    const text = "---\ndescription-long: keep\n---\nB";
    expect(setTextProperty(text, "description", "x")).toBe('---\ndescription-long: keep\ndescription: "x"\n---\nB');
  });
});

describe("movedPath", () => {
  test("a file or folder lands in the folder under its own name", () => {
    expect(movedPath("Inbox/Plan.md", "Work/Clients")).toBe("Work/Clients/Plan.md");
    expect(movedPath("Plan.md", "Work")).toBe("Work/Plan.md");
    expect(movedPath("Work/Clients", "Archive")).toBe("Archive/Clients");
    expect(movedPath("Work/Clients/Plan.md", "")).toBe("Plan.md");
  });

  test("something already there stays put", () => {
    expect(movedPath("Work/Plan.md", "Work")).toBeNull();
    expect(movedPath("Plan.md", "")).toBeNull();
  });

  test("a folder can't go into itself or anything inside it", () => {
    expect(movedPath("Work", "Work")).toBeNull();
    expect(movedPath("Work", "Work/Clients")).toBeNull();
    expect(movedPath("Work", "Workshop")).toBe("Workshop/Work");
  });
});
