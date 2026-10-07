import { describe, expect, test } from "vitest";
import { setPinned } from "../../sidebar/core/pin";

describe("setPinned", () => {
  test("adds a pinned line, leaving comments and quoting alone", () => {
    const text = "---\ntitle: 'Quoted'  # keep me\ntags: [a, b]\n---\nBody";
    expect(setPinned(text, true)).toBe(
      "---\ntitle: 'Quoted'  # keep me\ntags: [a, b]\npinned: true\n---\nBody"
    );
  });

  test("removes only the pinned line", () => {
    const text = "---\na: 1\npinned: true\nb: 2\n---\nBody";
    expect(setPinned(text, false)).toBe("---\na: 1\nb: 2\n---\nBody");
  });

  test("removes a trailing pinned line", () => {
    expect(setPinned("---\na: 1\npinned: true\n---\nBody", false)).toBe("---\na: 1\n---\nBody");
  });

  test("rewrites an existing non-true value", () => {
    expect(setPinned("---\npinned: false\n---\nx", true)).toBe("---\npinned: true\n---\nx");
  });

  test("creates frontmatter when there is none", () => {
    expect(setPinned("# Note\nBody", true)).toBe("---\npinned: true\n---\n# Note\nBody");
  });

  test("unpinning a note without frontmatter changes nothing", () => {
    expect(setPinned("Body", false)).toBe("Body");
  });

  test("a frontmatter block holding only pinned collapses to empty", () => {
    expect(setPinned("---\npinned: true\n---\nBody", false)).toBe("---\n---\nBody");
  });

  test("keeps CRLF line endings", () => {
    expect(setPinned("---\r\na: 1\r\n---\r\nBody", true)).toBe(
      "---\r\na: 1\r\npinned: true\r\n---\r\nBody"
    );
  });

  test("does not touch a pinned: line in the body", () => {
    const text = "---\na: 1\n---\npinned: true in prose";
    expect(setPinned(text, false)).toBe(text);
  });
});

describe("setPinned round trips", () => {
  test("re-pinning an emptied block reuses it instead of adding a second", () => {
    const once = setPinned(setPinned("---\npinned: true\n---\nBody", false), true);
    expect(once).toBe("---\npinned: true\n---\nBody");
  });

  test("pin then unpin restores the original", () => {
    const text = "---\na: 1 # c\n---\nBody";
    expect(setPinned(setPinned(text, true), false)).toBe(text);
  });
});
