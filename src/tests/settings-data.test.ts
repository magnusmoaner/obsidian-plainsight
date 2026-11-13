import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, listMinWidth, parseSavedSearches, parseSettings, serializeSettings } from "../settings-data";

describe("parseSettings", () => {
  test("nothing stored gives the defaults", () => {
    expect(parseSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, extra: {} });
    expect(parseSettings([1, 2])).toEqual({ settings: DEFAULT_SETTINGS, extra: {} });
  });

  test("keeps valid values", () => {
    const stored = {
      enabled: false,
      takeOverRendering: true,
      tasks: false,
      defaultTaskNote: "Todo list.md",
      boards: false,
      kanbanBoards: false,
      taskListBoards: false,
      boardListMinWidth: 260,
      showBoardsRow: false,
      boardCardsInTasks: true,
      hoverPreviews: false,
      listInsetTop: true,
      listInsetBottom: false,
      listInsetLeft: true,
      listInsetRight: true,
      showActionRow: false,
      showSearchButton: false,
      showDailyNoteButton: false,
      showNewFolderButton: false,
      showNewTaskButton: true,
      showMoreButton: false,
      showDailyNotes: false,
      showTemplates: true,
      savedSearches: [{ name: "Late reports", place: { kind: "tasks" }, query: "is:overdue report", taskFilter: "open" }],
      showSavedSearches: false,
    };
    expect(parseSettings(stored).settings).toEqual(stored);
  });

  test("a value of the wrong type falls back to its default", () => {
    const { settings } = parseSettings({ enabled: "yes", boardCardsInTasks: 0, defaultTaskNote: 42 });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  test("unknown keys are kept aside, so a save never drops them", () => {
    const { extra } = parseSettings({ enabled: true, futureOption: { a: 1 } });
    expect(extra).toEqual({ futureOption: { a: 1 } });
    expect(serializeSettings(DEFAULT_SETTINGS, extra)).toEqual({ ...DEFAULT_SETTINGS, futureOption: { a: 1 } });
  });

  test("a retired setting isn't carried along", () => {
    expect(parseSettings({ sidebar: false, showNoteButton: false, writingTools: [], menuCommands: "" }).extra).toEqual({});
  });

  test("view state moved to the device isn't carried along", () => {
    const { extra } = parseSettings({
      sidebarNavWidth: 230,
      sidebarCollapsed: [],
      taskGroupBy: "due",
      noteKindFilter: "all",
      noteGroupBy: "date",
    });
    expect(extra).toEqual({});
  });
});

describe("listMinWidth", () => {
  test("the default, a chosen width, and values outside the range", () => {
    expect(listMinWidth(DEFAULT_SETTINGS)).toBe(190);
    expect(listMinWidth({ ...DEFAULT_SETTINGS, boardListMinWidth: 264.6 })).toBe(265);
    expect(listMinWidth({ ...DEFAULT_SETTINGS, boardListMinWidth: 20 })).toBe(150);
    expect(listMinWidth({ ...DEFAULT_SETTINGS, boardListMinWidth: 9000 })).toBe(400);
    expect(listMinWidth({ ...DEFAULT_SETTINGS, boardListMinWidth: NaN })).toBe(190);
  });
});

describe("parseSavedSearches", () => {
  test("keeps whole searches for every kind of list, in order", () => {
    const stored = [
      { name: "Urgent", place: { kind: "tasks" }, query: "priority:high", taskFilter: "overdue" },
      { name: "Client invoices", place: { kind: "notebook", folder: "Work/Clients" }, query: "invoice" },
      { name: "paint", place: { kind: "tag", tag: "home" }, query: "paint" },
      { name: "Kitchen boards", place: { kind: "boards" }, query: "kitchen" },
    ];
    expect(parseSavedSearches(stored)).toEqual(stored);
  });

  test("a search without a name is called by its query", () => {
    expect(parseSavedSearches([{ place: { kind: "tasks" }, query: " in:work " }, { name: "  ", place: { kind: "notes" }, query: "plan" }])).toEqual([
      { name: "in:work", place: { kind: "tasks" }, query: " in:work " },
      { name: "plan", place: { kind: "notes" }, query: "plan" },
    ]);
  });

  test("drops what isn't a whole search, and a tab on anything but Tasks", () => {
    expect(
      parseSavedSearches([
        null,
        "tasks",
        { place: { kind: "tasks" }, query: "  " },
        { place: { kind: "nowhere" }, query: "x" },
        { place: { kind: "notebook" }, query: "x" },
        { query: "x" },
        { place: { kind: "notes", extra: 1 }, query: "plan", taskFilter: "done" },
        { place: { kind: "tasks" }, query: "x", taskFilter: "someday" },
      ])
    ).toEqual([
      { name: "plan", place: { kind: "notes" }, query: "plan" },
      { name: "x", place: { kind: "tasks" }, query: "x" },
    ]);
    expect(parseSavedSearches("nope")).toEqual([]);
    expect(parseSettings({ savedSearches: { a: 1 } }).settings.savedSearches).toEqual([]);
  });
});
