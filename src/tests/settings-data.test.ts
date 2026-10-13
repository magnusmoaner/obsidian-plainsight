import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from "../settings-data";

describe("parseSettings", () => {
  test("nothing stored gives the defaults", () => {
    expect(parseSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, extra: {} });
    expect(parseSettings([1, 2])).toEqual({ settings: DEFAULT_SETTINGS, extra: {} });
  });

  test("keeps valid values", () => {
    const stored = {
      enabled: false,
      takeOverRendering: true,
      sidebar: false,
      defaultTaskNote: "Tasks Inbox.md",
      boardCardsInTasks: true,
    };
    expect(parseSettings(stored).settings).toEqual(stored);
  });

  test("a value of the wrong type falls back to its default", () => {
    const { settings } = parseSettings({ enabled: "yes", sidebar: 0, defaultTaskNote: 42 });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  test("unknown keys are kept aside, so a save never drops them", () => {
    const { extra } = parseSettings({ enabled: true, futureOption: { a: 1 } });
    expect(extra).toEqual({ futureOption: { a: 1 } });
    expect(serializeSettings(DEFAULT_SETTINGS, extra)).toEqual({ ...DEFAULT_SETTINGS, futureOption: { a: 1 } });
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
