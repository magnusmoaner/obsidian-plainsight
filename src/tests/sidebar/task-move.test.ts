import { describe, expect, test } from "vitest";
import { appendTask, landing, moveTask, placeTask, takeTask, taskAsCard } from "../../sidebar/core/task-move";

const NOTE = [
  "# Shed",
  "",
  "- [ ] Buy paint 📅 2026-11-20",
  "- [ ] Fix the gate",
  "    - [ ] Order hinges",
  "    a note about the gate",
  "- [x] Pick colours",
  "",
  "Done for now.",
].join("\n");

const ref = (line: number, status: string, text: string) => ({ line, status, text });

describe("takeTask", () => {
  test("takes the task's line out of the note", () => {
    const out = takeTask(NOTE, ref(2, " ", "Buy paint 📅 2026-11-20"))!;
    expect(out.block).toEqual(["- [ ] Buy paint 📅 2026-11-20"]);
    expect(out.text).toBe(NOTE.replace("- [ ] Buy paint 📅 2026-11-20\n", ""));
  });

  test("the lines indented under a task go with it", () => {
    const out = takeTask(NOTE, ref(3, " ", "Fix the gate"))!;
    expect(out.block).toEqual(["- [ ] Fix the gate", "    - [ ] Order hinges", "    a note about the gate"]);
    expect(out.text.split("\n")).toEqual(["# Shed", "", "- [ ] Buy paint 📅 2026-11-20", "- [x] Pick colours", "", "Done for now."]);
  });

  test("a blank line inside a task goes with it, one after it doesn't", () => {
    const text = ["- [ ] Paint the shed", "    ", "    Two coats", "", "- [ ] Next"].join("\n");
    expect(takeTask(text, { line: 0, status: " ", text: "Paint the shed" })).toEqual({
      text: "\n- [ ] Next",
      block: ["- [ ] Paint the shed", "    ", "    Two coats"],
    });
  });

  test("a subtask comes out without its indent, and leaves its parent", () => {
    const out = takeTask(NOTE, ref(4, " ", "Order hinges"))!;
    expect(out.block).toEqual(["- [ ] Order hinges"]);
    expect(out.text).toContain("- [ ] Fix the gate\n    a note about the gate");
  });

  test("a line that is no longer that task is left alone", () => {
    expect(takeTask(NOTE, ref(2, " ", "Buy brushes"))).toBeNull();
    expect(takeTask(NOTE, ref(2, "x", "Buy paint 📅 2026-11-20"))).toBeNull();
    expect(takeTask(NOTE, ref(8, " ", "Done for now."))).toBeNull();
    expect(takeTask(NOTE, ref(40, " ", "Buy paint"))).toBeNull();
  });

  test("Windows line endings are kept", () => {
    const out = takeTask(NOTE.replace(/\n/g, "\r\n"), ref(2, " ", "Buy paint 📅 2026-11-20"))!;
    expect(out.text).toContain("# Shed\r\n\r\n- [ ] Fix the gate");
    expect(out.block).toEqual(["- [ ] Buy paint 📅 2026-11-20"]);
  });
});

describe("placeTask", () => {
  const block = ["- [ ] New task", "    with a note"];

  test("goes on lines of its own, before the line it's dropped on", () => {
    expect(placeTask("One\nTwo", 1, ["- [ ] New task"])).toBe("One\n- [ ] New task\nTwo");
    expect(placeTask("One\nTwo", 2, ["- [ ] New task"])).toBe("One\nTwo\n- [ ] New task");
    expect(placeTask("", 0, ["- [ ] New task"])).toBe("- [ ] New task\n");
  });

  test("beside a list item it takes that item's depth", () => {
    const out = placeTask(NOTE, 5, block).split("\n");
    expect(out.slice(4, 7)).toEqual(["    - [ ] Order hinges", "    - [ ] New task", "        with a note"]);
    expect(placeTask(NOTE, 3, ["- [ ] New task"]).split("\n")[3]).toBe("- [ ] New task");
  });

  test("never lands inside the properties at the top of a note", () => {
    const note = "---\ntags: [home]\n---\nText";
    expect(placeTask(note, 0, ["- [ ] New task"])).toBe("---\ntags: [home]\n---\n- [ ] New task\nText");
    expect(placeTask(note, 2, ["- [ ] New task"])).toBe("---\ntags: [home]\n---\n- [ ] New task\nText");
    expect(landing(note.split("\n"), 1)).toEqual({ before: 3, indent: "" });
  });
});

describe("appendTask", () => {
  test("adds the task after everything in the note", () => {
    expect(appendTask("Text\n\n\n", ["- [ ] New task"])).toBe("Text\n- [ ] New task\n");
    expect(appendTask("", ["- [ ] New task"])).toBe("- [ ] New task\n");
  });
});

describe("moveTask", () => {
  test("moves a task down and up within its note, with what's under it", () => {
    const down = moveTask(NOTE, ref(2, " ", "Buy paint 📅 2026-11-20"), 7)!.split("\n");
    expect(down.slice(2, 7)).toEqual(["- [ ] Fix the gate", "    - [ ] Order hinges", "    a note about the gate", "- [x] Pick colours", "- [ ] Buy paint 📅 2026-11-20"]);
    const up = moveTask(NOTE, ref(3, " ", "Fix the gate"), 2)!.split("\n");
    expect(up.slice(2, 6)).toEqual(["- [ ] Fix the gate", "    - [ ] Order hinges", "    a note about the gate", "- [ ] Buy paint 📅 2026-11-20"]);
  });

  test("dropped on itself, or among its own lines, nothing changes", () => {
    expect(moveTask(NOTE, ref(3, " ", "Fix the gate"), 3)).toBe(NOTE);
    expect(moveTask(NOTE, ref(3, " ", "Fix the gate"), 5)).toBe(NOTE);
    expect(moveTask(NOTE, ref(3, " ", "Fix the gate"), 6)).toBe(NOTE);
  });

  test("a stale task isn't moved", () => {
    expect(moveTask(NOTE, ref(3, " ", "Fix the fence"), 0)).toBeNull();
  });

  test("a subtask pulled out to the top of the list loses its indent", () => {
    const out = moveTask(NOTE, ref(4, " ", "Order hinges"), 2)!.split("\n");
    expect(out.slice(2, 5)).toEqual(["- [ ] Order hinges", "- [ ] Buy paint 📅 2026-11-20", "- [ ] Fix the gate"]);
  });
});

describe("taskAsCard", () => {
  test("a task becomes a card with its status and text; lines under it become the card's other lines", () => {
    expect(taskAsCard(["- [ ] Buy paint 📅 2026-11-20"])).toEqual({ check: " ", body: "Buy paint 📅 2026-11-20" });
    expect(taskAsCard(["- [/] Fix the gate", "    - [ ] Order hinges", "    a note"])).toEqual({ check: "/", body: "Fix the gate\n- [ ] Order hinges\na note" });
  });
});
