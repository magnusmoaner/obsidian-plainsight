import { describe, expect, test } from "vitest";
import { cardTitle } from "../../sidebar/core/task-details";

describe("cardTitle", () => {
  test("a plain card is its own title", () => {
    expect(cardTitle("Order the tiles")).toBe("Order the tiles");
  });

  test("the Tasks plugin's details are left out", () => {
    expect(cardTitle("Buy paint 📅 2026-11-20 ⏫ 🔁 every week")).toBe("Buy paint");
    expect(cardTitle("Pick a tap 🆔 abc123 ➕ 2026-11-01 ⏳ 2026-11-15 🛫 2026-11-13")).toBe("Pick a tap");
    expect(cardTitle("Choose the worktop ✅ 2026-11-06")).toBe("Choose the worktop");
  });

  test("Kanban's date and time, block ids and Dataview fields are left out", () => {
    expect(cardTitle("Book the electrician @{2026-11-14} @@{14:00}")).toBe("Book the electrician");
    expect(cardTitle("Ask about the shed [due:: 2026-11-30] ^k3x9")).toBe("Ask about the shed");
    expect(cardTitle("Call (owner:: Ana) the plumber")).toBe("Call the plumber");
  });

  test("tags are left out, wherever they are", () => {
    expect(cardTitle("#home Paint samples #shopping")).toBe("Paint samples");
    expect(cardTitle("Paint #home samples")).toBe("Paint samples");
  });

  test("Markdown and links show as their text", () => {
    expect(cardTitle("Pick a **good** tap")).toBe("Pick a good tap");
    expect(cardTitle("Ask [[Garden plan|Ana]] about [[Shed]]")).toBe("Ask Ana about Shed");
    expect(cardTitle("Read [the guide](https://example.com)")).toBe("Read the guide");
  });

  test("only the first line of a card is its title, and an empty one has a stand-in", () => {
    expect(cardTitle("Fix the gate\nsecond line")).toBe("Fix the gate");
    expect(cardTitle("📅 2026-11-20")).toBe("Untitled");
  });
});
