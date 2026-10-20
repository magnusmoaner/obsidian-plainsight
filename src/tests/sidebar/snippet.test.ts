import { describe, expect, test } from "vitest";
import { extractSnippet } from "../../sidebar/core/snippet";

describe("extractSnippet", () => {
  test("skips frontmatter and headings", () => {
    const text = "---\ntags: [a]\n---\n# Title\n\nFirst real line.";
    expect(extractSnippet(text)).toBe("First real line.");
  });

  test("joins short lines until the length budget", () => {
    expect(extractSnippet("one\ntwo\nthree")).toBe("one two three");
  });

  test("truncates with an ellipsis", () => {
    const s = extractSnippet("word ".repeat(100), 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith("…")).toBe(true);
  });

  test("strips inline syntax and resolves link text", () => {
    expect(
      extractSnippet("See **bold**, *em*, `code`, ==hi==, [[Note]] and [[Target|alias]].")
    ).toBe("See bold, em, code, hi, Note and alias.");
  });

  test("drops the heading part of a wikilink", () => {
    expect(extractSnippet("Go to [[Note#Section]] now")).toBe("Go to Note now");
  });

  test("keeps markdown link text, drops embeds and images", () => {
    expect(extractSnippet("![[pic.png]] a [site](https://x.dk) ![alt](i.png) b")).toBe(
      "a site b"
    );
  });

  test("strips callout tokens and quote markers but keeps the text", () => {
    expect(extractSnippet("> [!info] Heads up\n> body text")).toBe("Heads up body text");
  });

  test("strips list and task markers", () => {
    expect(extractSnippet("- [ ] Buy milk\n1. Step one")).toBe("Buy milk Step one");
  });

  test("skips fenced code contents, rules and tables", () => {
    const text = "```\ncode()\n```\n---\n| a | b |\nAfter.";
    expect(extractSnippet(text)).toBe("After.");
  });

  test("strips Dataview fields, keeping their values", () => {
    expect(extractSnippet("status:: active\nDue [due:: 2026-10-09] and (owner:: Magnus)")).toBe(
      "active Due 2026-10-09 and Magnus"
    );
  });

  test("code with :: is not a Dataview field", () => {
    expect(extractSnippet("std::vector is great")).toBe("std::vector is great");
    expect(extractSnippet("Example (see std::move) here")).toBe("Example (see std::move) here");
    expect(extractSnippet("Server at [fe80::1] is up")).toBe("Server at [fe80::1] is up");
    expect(extractSnippet("I like (things like Foo::Bar and more) right")).toBe(
      "I like (things like Foo::Bar and more) right"
    );
  });

  test("a field whose value is a link keeps the link text", () => {
    expect(extractSnippet("Meet (who:: [[Page|Alias]]) now")).toBe("Meet Alias now");
    expect(extractSnippet("See [src:: [site](https://x.dk)] here")).toBe("See site here");
  });

  test("bold and emoji keys are fields too", () => {
    expect(extractSnippet("**Status**:: done")).toBe("done");
    expect(extractSnippet("🎯:: goal")).toBe("goal");
  });

  test("a long line of unclosed openers stays fast", () => {
    const line = "(a:: ".repeat(2000);
    const start = Date.now();
    extractSnippet(line);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("a plain colon is not a Dataview field", () => {
    expect(extractSnippet("Note: remember this")).toBe("Note: remember this");
  });

  test("empty and syntax-only notes give an empty snippet", () => {
    expect(extractSnippet("")).toBe("");
    expect(extractSnippet("---\na: 1\n---\n# Only a heading")).toBe("");
  });
});
