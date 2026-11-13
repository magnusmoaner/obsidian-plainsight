import { describe, expect, test } from "vitest";
import {
  addCard,
  addLane,
  appendEmbed,
  cardDisplay,
  CardRef,
  deleteCard,
  deleteLane,
  editCard,
  embedBlock,
  embedTarget,
  LaneRef,
  moveCard,
  moveLane,
  NEW_BOARD,
  parseBoard,
  renameLane,
  retargetEmbeds,
  setCardStatus,
  setLaneCollapsed,
  setLaneColour,
  setLaneStatus,
  StaleBoardError,
  toggleCard,
} from "../../boards/board";

/** A board with three empty lists and no settings block. */
const PLAIN = [
  "---",
  "plainsight-plugin: board",
  "---",
  "",
  "## To do",
  "",
  "",
  "",
  "## Doing",
  "",
  "",
  "",
  "## Done",
  "",
  "**Complete**",
  "",
  "",
  "",
].join("\n");

const SETTINGS = ["%% kanban:settings", "```", '{"kanban-plugin":"board"}', "```", "%%"];

const BOARD = [
  "---",
  "",
  "kanban-plugin: board",
  "",
  "---",
  "",
  "## To do (3)",
  "",
  "- [ ] Buy paint @{2026-01-31}",
  "- [/] Fix the gate",
  "    second line",
  "",
  "",
  "## Done",
  "",
  "**Complete**",
  "- [x] Pick colours",
  "",
  "",
  "",
  "***",
  "",
  "## Archive",
  "",
  "- [x] Old card",
  "",
  ...SETTINGS,
].join("\n");

function cardRef(text: string, lane: number, card: number): CardRef {
  const c = parseBoard(text).lanes[lane].cards[card];
  return { lane, card, raw: text.split("\n")[c.line] };
}

function laneRef(text: string, lane: number): LaneRef {
  return { lane, raw: text.split("\n")[parseBoard(text).lanes[lane].line] };
}

/** Lists and card texts, for compact assertions. */
function shape(text: string): string[][] {
  return parseBoard(text).lanes.map((l) => [l.title, ...l.cards.map((c) => `[${c.check}] ${c.text}`)]);
}

describe("parseBoard", () => {
  test("reads lists, WIP limits, the complete marker and multi-line cards", () => {
    const board = parseBoard(BOARD);
    expect(board.lanes.map((l) => [l.title, l.limit, l.marker !== null])).toEqual([
      ["To do", "3", false],
      ["Done", "", true],
    ]);
    expect(board.lanes[0].cards[1]).toMatchObject({ check: "/", text: "Fix the gate\nsecond line" });
  });

  test("the archive and settings block are not part of the board", () => {
    expect(shape(BOARD)).toEqual([
      ["To do", "[ ] Buy paint @{2026-01-31}", "[/] Fix the gate\nsecond line"],
      ["Done", "[x] Pick colours"],
    ]);
  });

  test("a plain board with three empty lists reads as such", () => {
    expect(shape(PLAIN)).toEqual([["To do"], ["Doing"], ["Done"]]);
    expect(parseBoard(PLAIN).lanes[2].marker).not.toBeNull();
  });

  test("a new board has Inbox, Doing and Done, coloured, and Done completes its cards", () => {
    const lanes = parseBoard(NEW_BOARD).lanes;
    expect(lanes.map((l) => [l.title, l.colour, l.status, l.cards.length])).toEqual([
      ["Inbox", null, null, 0],
      ["Doing", "blue", null, 0],
      ["Done", "green", "x", 0],
    ]);
  });

  test("a new board takes cards and lists like any other, keeping its colours", () => {
    const card = addCard(NEW_BOARD, laneRef(NEW_BOARD, 0), "Buy paint");
    expect(card).toContain("## Inbox\n\n- [ ] Buy paint\n");
    expect(shape(addCard(NEW_BOARD, laneRef(NEW_BOARD, 2), "Old job"))[2]).toEqual(["Done", "[x] Old job"]);
    const more = addLane(card, "Later");
    expect(parseBoard(more).lanes.map((l) => `${l.title}:${l.colour}`)).toEqual(["Inbox:null", "Doing:blue", "Done:green", "Later:null"]);
  });
});

describe("card edits", () => {
  test("toggle flips open and done, and any other status to open", () => {
    expect(shape(toggleCard(BOARD, cardRef(BOARD, 0, 0)))[0][1]).toBe("[x] Buy paint @{2026-01-31}");
    expect(shape(toggleCard(BOARD, cardRef(BOARD, 0, 1)))[0][2]).toMatch(/^\[ \] Fix the gate/);
    expect(shape(toggleCard(BOARD, cardRef(BOARD, 1, 0)))[1][1]).toBe("[ ] Pick colours");
  });

  test("edit replaces all of a multi-line card and keeps its status", () => {
    const out = editCard(BOARD, cardRef(BOARD, 0, 1), "Fix the fence\nby Friday");
    expect(out).toContain("- [/] Fix the fence\n    by Friday\n\n");
    expect(shape(out)[0]).toHaveLength(3);
  });

  test("add goes to the bottom of the list; a complete list checks it", () => {
    expect(shape(addCard(BOARD, laneRef(BOARD, 0), "New"))[0][3]).toBe("[ ] New");
    expect(shape(addCard(BOARD, laneRef(BOARD, 1), "New"))[1][2]).toBe("[x] New");
  });

  test("add to an empty list leaves Kanban's blank line under the heading", () => {
    const out = addCard(PLAIN, laneRef(PLAIN, 1), "First");
    expect(out).toContain("## Doing\n\n- [ ] First\n");
    expect(addCard(PLAIN, laneRef(PLAIN, 2), "Done one")).toContain("**Complete**\n- [x] Done one\n");
  });

  test("delete removes every line of the card", () => {
    expect(shape(deleteCard(BOARD, cardRef(BOARD, 0, 1)))[0]).toEqual(["To do", "[ ] Buy paint @{2026-01-31}"]);
  });

  test("move within a list, both directions", () => {
    expect(shape(moveCard(BOARD, cardRef(BOARD, 0, 0), laneRef(BOARD, 0), 2))[0].map((c) => c.slice(0, 12))).toEqual([
      "To do",
      "[/] Fix the ",
      "[ ] Buy pain",
    ]);
    expect(shape(moveCard(BOARD, cardRef(BOARD, 0, 1), laneRef(BOARD, 0), 0))[0][1]).toMatch(/^\[\/\] Fix the gate/);
  });

  test("dropping a card where it is changes nothing", () => {
    expect(moveCard(BOARD, cardRef(BOARD, 0, 0), laneRef(BOARD, 0), 1)).toBe(BOARD);
  });

  test("moving into a complete list checks the card; moving out unchecks it", () => {
    const into = moveCard(BOARD, cardRef(BOARD, 0, 0), laneRef(BOARD, 1), 1);
    expect(shape(into)).toEqual([
      ["To do", "[/] Fix the gate\nsecond line"],
      ["Done", "[x] Pick colours", "[x] Buy paint @{2026-01-31}"],
    ]);
    const out = moveCard(BOARD, cardRef(BOARD, 1, 0), laneRef(BOARD, 0), 0);
    expect(shape(out)[0][1]).toBe("[ ] Pick colours");
  });

  test("an edit on a card that changed since the board was drawn is refused", () => {
    const ref = cardRef(BOARD, 0, 0);
    const changed = BOARD.replace("Buy paint", "Buy brushes");
    expect(() => toggleCard(changed, ref)).toThrow(StaleBoardError);
  });

  test("the archive and settings block survive every edit", () => {
    const tail = BOARD.slice(BOARD.indexOf("***"));
    const out = moveLane(deleteCard(addCard(BOARD, laneRef(BOARD, 1), "x"), cardRef(BOARD, 0, 0)), laneRef(BOARD, 1), 0);
    expect(out.endsWith(tail)).toBe(true);
  });
});

describe("list edits", () => {
  test("add goes after the last list, before the archive", () => {
    const out = addLane(BOARD, "Later");
    expect(shape(out).map((l) => l[0])).toEqual(["To do", "Done", "Later"]);
    expect(out).toContain("## Later\n\n\n\n***");
  });

  test("rename keeps the WIP limit", () => {
    expect(renameLane(BOARD, laneRef(BOARD, 0), "Next")).toContain("## Next (3)\n");
  });

  test("delete removes the list and its cards", () => {
    expect(shape(deleteLane(BOARD, laneRef(BOARD, 0)))).toEqual([["Done", "[x] Pick colours"]]);
  });

  test("move reorders lists, both directions", () => {
    const titles = (t: string) => shape(t).map((l) => l[0]);
    expect(titles(moveLane(PLAIN, laneRef(PLAIN, 0), 3))).toEqual(["Doing", "Done", "To do"]);
    expect(titles(moveLane(PLAIN, laneRef(PLAIN, 2), 0))).toEqual(["Done", "To do", "Doing"]);
    const moved = moveLane(BOARD, laneRef(BOARD, 1), 0);
    expect(shape(moved)[0]).toEqual(["Done", "[x] Pick colours"]);
    expect(parseBoard(moved).lanes[0].marker).not.toBeNull();
  });
});

describe("cardDisplay", () => {
  test("takes out the date, time and block id", () => {
    expect(cardDisplay("Call **Ann** @{2026-01-31} @@{14:00} ^ab12")).toEqual({
      body: "Call **Ann**",
      date: "2026-01-31",
      time: "14:00",
    });
  });

  test("reads a date linked to a daily note", () => {
    expect(cardDisplay("Pay rent @[[2026-02-01]]")).toMatchObject({ body: "Pay rent", date: "2026-02-01" });
  });
});

describe("statuses", () => {
  test("a card can be set to any status", () => {
    expect(shape(setCardStatus(BOARD, cardRef(BOARD, 0, 0), "/"))[0][1]).toBe("[/] Buy paint @{2026-01-31}");
    expect(shape(setCardStatus(BOARD, cardRef(BOARD, 0, 1), "-"))[0][2]).toMatch(/^\[-\] Fix the gate/);
  });

  test("a list's done status is Kanban's Complete line; other statuses go in the settings block", () => {
    const done = setLaneStatus(PLAIN, laneRef(PLAIN, 0), "x");
    expect(done).toContain("## To do\n\n**Complete**\n");
    const doing = setLaneStatus(BOARD, laneRef(BOARD, 0), "/");
    expect(doing).toContain('{"kanban-plugin":"board","plainsight-list-status":{"To do":"/"}}');
    expect(parseBoard(doing).lanes.map((l) => l.status)).toEqual(["/", "x"]);
  });

  test("a board without a settings block gets one when a list needs it", () => {
    const out = setLaneStatus(PLAIN, laneRef(PLAIN, 1), "-");
    expect(out.endsWith('%% kanban:settings\n```\n{"kanban-plugin":"board","plainsight-list-status":{"Doing":"-"}}\n```\n%%')).toBe(true);
    expect(parseBoard(out).lanes.map((l) => l.status)).toEqual([null, "-", "x"]);
  });

  test("clearing a status removes the Complete line and the stored entry", () => {
    const plain = setLaneStatus(BOARD, laneRef(BOARD, 1), null);
    expect(plain).not.toContain("**Complete**");
    const doing = setLaneStatus(BOARD, laneRef(BOARD, 0), "/");
    expect(setLaneStatus(doing, laneRef(doing, 0), null)).toContain('{"kanban-plugin":"board"}');
  });

  test("a list's status follows a rename and goes with a delete", () => {
    const doing = setLaneStatus(BOARD, laneRef(BOARD, 0), "/");
    expect(parseBoard(renameLane(doing, laneRef(doing, 0), "Now")).lanes[0]).toMatchObject({ title: "Now", status: "/" });
    expect(deleteLane(doing, laneRef(doing, 0))).toContain('{"kanban-plugin":"board"}');
  });

  test("cards take the status of the list they land in, and lose it when they leave", () => {
    const doing = setLaneStatus(PLAIN, laneRef(PLAIN, 1), "/");
    const added = addCard(doing, laneRef(doing, 1), "Paint the shed");
    expect(shape(added)[1][1]).toBe("[/] Paint the shed");
    const back = moveCard(added, cardRef(added, 1, 0), laneRef(added, 0), 0);
    expect(shape(back)[0][1]).toBe("[ ] Paint the shed");
    const plain = addCard(doing, laneRef(doing, 0), "Sand the door");
    const moved = moveCard(plain, cardRef(plain, 0, 0), laneRef(plain, 1), 0);
    expect(shape(moved)[1][1]).toBe("[/] Sand the door");
  });

  test("an unreadable settings block is left alone", () => {
    const broken = BOARD.replace('{"kanban-plugin":"board"}', "{oops");
    expect(setLaneStatus(broken, laneRef(broken, 0), "/")).toBe(broken);
  });
});

describe("embed blocks", () => {
  test("a block names its board by link or path", () => {
    expect(embedTarget("title: Plan\nboard: [[Garden/Plan board|Plan]]")).toBe("Garden/Plan board");
    expect(embedTarget("board: Garden/Plan board.md")).toBe("Garden/Plan board.md");
    expect(embedTarget("lanes: Todo")).toBeNull();
    expect(embedTarget(embedBlock("Plan board").split("\n")[1])).toBe("Plan board");
  });

  test("a board is embedded at the end of a note, after a blank line", () => {
    expect(appendEmbed("Plans for the shed.\n\n\n", "Shed board")).toBe("Plans for the shed.\n\n```plainsight-board\nboard: [[Shed board]]\n```\n");
    expect(appendEmbed("---\ntags: [home]\n---\nText", "Shed board")).toBe("---\ntags: [home]\n---\nText\n\n```plainsight-board\nboard: [[Shed board]]\n```\n");
    expect(appendEmbed("", "Shed board")).toBe("```plainsight-board\nboard: [[Shed board]]\n```\n");
    expect(embedTarget(appendEmbed("Text", "Folder/Shed board"))).toBe("Folder/Shed board");
  });

  test("a renamed board is retargeted in the blocks that named it, and nowhere else", () => {
    const note = ["See [[Plan board]].", "", "```plainsight-board", "board: [[Plan board]]", "```", "", "```kanban-embed", "board: [[Garden/Plan board|Plan]]", "```", "", "```plainsight-board", "board: [[Other board]]", "```"].join("\n");
    const out = retargetEmbeds(note, "Garden/Plan board.md", "Garden/Beds");
    expect(out).toContain("See [[Plan board]].");
    expect(out).toContain("```plainsight-board\nboard: [[Garden/Beds]]\n```");
    expect(out).toContain("board: [[Garden/Beds|Plan]]");
    expect(out).toContain("board: [[Other board]]");
  });
});

describe("minimized lists", () => {
  const collapsed = (t: string) => parseBoard(t).lanes.map((l) => `${l.title}:${l.collapsed}`);

  test("a list is minimized through the Kanban plugin's own setting", () => {
    const out = setLaneCollapsed(BOARD, laneRef(BOARD, 1), true);
    expect(out).toContain('{"kanban-plugin":"board","list-collapse":[false,true]}');
    expect(collapsed(out)).toEqual(["To do:false", "Done:true"]);
    expect(collapsed(setLaneCollapsed(out, laneRef(out, 1), false))).toEqual(["To do:false", "Done:false"]);
  });

  test("a minimized list stays minimized when lists move or go", () => {
    const one = setLaneCollapsed(PLAIN, laneRef(PLAIN, 0), true);
    expect(collapsed(moveLane(one, laneRef(one, 0), 3))).toEqual(["Doing:false", "Done:false", "To do:true"]);
    expect(collapsed(moveLane(one, laneRef(one, 2), 0))).toEqual(["Done:false", "To do:true", "Doing:false"]);
    expect(collapsed(deleteLane(one, laneRef(one, 1)))).toEqual(["To do:true", "Done:false"]);
    expect(collapsed(deleteLane(one, laneRef(one, 0)))).toEqual(["Doing:false", "Done:false"]);
  });

  test("moving or deleting lists on a board with none minimized stores nothing", () => {
    expect(moveLane(PLAIN, laneRef(PLAIN, 0), 3)).not.toContain("kanban:settings");
    expect(deleteLane(BOARD, laneRef(BOARD, 0))).toContain('{"kanban-plugin":"board"}');
  });
});

describe("through the Tasks plugin", () => {
  // Stands in for the Tasks plugin: a done date on completing, and a
  // repeating task's next round as a line above it.
  const tasks = (line: string): string => {
    if (/\[[xX]\]/.test(line)) return line.replace(/\[[xX]\]/, "[ ]").replace(/ ✅ \S+$/, "");
    const done = line.replace(/\[.\]/, "[x]") + " ✅ 2026-01-02";
    return line.includes("🔁") ? `${line}\n${done}` : done;
  };

  test("ticking a card gives it a done date; unticking takes it away", () => {
    const done = toggleCard(BOARD, cardRef(BOARD, 0, 0), tasks);
    expect(shape(done)[0][1]).toBe("[x] Buy paint @{2026-01-31} ✅ 2026-01-02");
    expect(toggleCard(done, cardRef(done, 0, 0), tasks)).toBe(BOARD);
  });

  test("a multi-line card keeps its other lines", () => {
    expect(toggleCard(BOARD, cardRef(BOARD, 0, 1), tasks)).toContain("- [x] Fix the gate ✅ 2026-01-02\n    second line\n");
  });

  test("a repeating card leaves its next round behind", () => {
    const board = addCard(PLAIN, laneRef(PLAIN, 0), "Water plants 🔁 every week");
    expect(shape(toggleCard(board, cardRef(board, 0, 0), tasks))[0]).toEqual([
      "To do",
      "[ ] Water plants 🔁 every week",
      "[x] Water plants 🔁 every week ✅ 2026-01-02",
    ]);
  });

  test("marking as done from the menu, and dropping on a done list, date the card too", () => {
    expect(shape(setCardStatus(BOARD, cardRef(BOARD, 0, 0), "x", tasks))[0][1]).toMatch(/✅ 2026-01-02$/);
    expect(shape(setCardStatus(BOARD, cardRef(BOARD, 0, 0), "/", tasks))[0][1]).toBe("[/] Buy paint @{2026-01-31}");
    const moved = moveCard(BOARD, cardRef(BOARD, 0, 0), laneRef(BOARD, 1), 1, tasks);
    expect(shape(moved)[1][2]).toBe("[x] Buy paint @{2026-01-31} ✅ 2026-01-02");
    const back = moveCard(moved, cardRef(moved, 1, 1), laneRef(moved, 0), 0, tasks);
    expect(shape(back)[0][1]).toBe("[ ] Buy paint @{2026-01-31}");
  });

  test("without the Tasks plugin a card is just ticked", () => {
    expect(shape(toggleCard(BOARD, cardRef(BOARD, 0, 0), () => null))[0][1]).toBe("[x] Buy paint @{2026-01-31}");
  });
});

describe("list colours", () => {
  const colours = (t: string) => parseBoard(t).lanes.map((l) => `${l.title}:${l.colour}`);

  test("a list's colour is kept by its name in the settings block, and can be taken away", () => {
    const blue = setLaneColour(BOARD, laneRef(BOARD, 0), "blue");
    expect(blue).toContain('{"kanban-plugin":"board","plainsight-list-colour":{"To do":"blue"}}');
    expect(colours(blue)).toEqual(["To do:blue", "Done:null"]);
    expect(setLaneColour(blue, laneRef(blue, 0), null)).toBe(BOARD);
  });

  test("a board without a settings block gets one for its first colour", () => {
    const out = setLaneColour(PLAIN, laneRef(PLAIN, 1), "green");
    expect(colours(out)).toEqual(["To do:null", "Doing:green", "Done:null"]);
    expect(out).toContain('"plainsight-list-colour":{"Doing":"green"}');
  });

  test("a colour that isn't one of the list is not stored, and one written by hand is not read", () => {
    expect(setLaneColour(BOARD, laneRef(BOARD, 0), "#ff0000")).toBe(BOARD);
    const odd = BOARD.replace('{"kanban-plugin":"board"}', '{"kanban-plugin":"board","plainsight-list-colour":{"To do":"url(x)"}}');
    expect(colours(odd)).toEqual(["To do:null", "Done:null"]);
  });

  test("the colour follows a rename, a move and a status, and goes with a delete", () => {
    const blue = setLaneColour(PLAIN, laneRef(PLAIN, 0), "blue");
    expect(colours(renameLane(blue, laneRef(blue, 0), "Next"))).toEqual(["Next:blue", "Doing:null", "Done:null"]);
    expect(colours(moveLane(blue, laneRef(blue, 0), 3))).toEqual(["Doing:null", "Done:null", "To do:blue"]);
    const both = setLaneStatus(blue, laneRef(blue, 0), "/");
    expect(parseBoard(both).lanes[0]).toMatchObject({ colour: "blue", status: "/" });
    expect(deleteLane(blue, laneRef(blue, 0))).not.toContain("plainsight-list-colour");
  });
});
