import { describe, expect, test } from "vitest";
import { DEFAULT_VIEW_STATE, legacyViewState, parseViewState } from "../../sidebar/core/view-state";

describe("parseViewState", () => {
  test("nothing stored gives the defaults", () => {
    expect(parseViewState(null)).toEqual(DEFAULT_VIEW_STATE);
    expect(parseViewState(undefined)).toEqual(DEFAULT_VIEW_STATE);
    expect(parseViewState("garbage")).toEqual(DEFAULT_VIEW_STATE);
  });

  test("keeps valid fields", () => {
    const state = {
      navWidth: 240,
      collapsed: ["section:tags", "notebook:Inbox"],
      taskGroupBy: "board",
      taskFilter: "done",
      noteKindFilter: "canvas",
      noteGroupBy: "folder",
      attachmentGroupBy: "type",
    };
    expect(parseViewState(state)).toEqual(state);
  });

  test("each malformed field falls back on its own", () => {
    expect(
      parseViewState({
        navWidth: "wide",
        collapsed: ["section:tags", 7, null, "section:tags"],
        taskGroupBy: "colour",
        taskFilter: "someday",
        noteKindFilter: "pdf",
        noteGroupBy: "kind",
        attachmentGroupBy: "kind",
      })
    ).toEqual({
      ...DEFAULT_VIEW_STATE,
      collapsed: ["section:tags"],
      noteGroupBy: "kind",
    });
  });

  test("clamps the column width to what the divider allows", () => {
    expect(parseViewState({ navWidth: 20 }).navWidth).toBe(152);
    expect(parseViewState({ navWidth: 9999 }).navWidth).toBe(360);
    expect(parseViewState({ navWidth: 212.6 }).navWidth).toBe(213);
    expect(parseViewState({ navWidth: Number.NaN }).navWidth).toBe(DEFAULT_VIEW_STATE.navWidth);
  });
});

describe("legacyViewState", () => {
  test("maps the keys older versions kept in data.json", () => {
    expect(
      legacyViewState({
        enabled: true,
        sidebarNavWidth: 230,
        sidebarCollapsed: ["section:bookmarks"],
        taskGroupBy: "note",
        noteKindFilter: "board",
        noteGroupBy: "none",
      })
    ).toEqual({
      navWidth: 230,
      collapsed: ["section:bookmarks"],
      taskGroupBy: "note",
      noteKindFilter: "board",
      noteGroupBy: "none",
    });
  });

  test("null when there's nothing to move", () => {
    expect(legacyViewState({ enabled: true, sidebar: false })).toBeNull();
  });
});
