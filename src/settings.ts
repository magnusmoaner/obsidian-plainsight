import { App, PluginSettingTab, Setting, SettingGroup } from "obsidian";
import { corePluginEnabled, dailyNotesFolder, openHotkeys, openSettingsTab, templateOptions } from "./sidebar/internals";
import { NoteSuggest } from "./sidebar/modals";
import type WysiwygPlugin from "./main";

import { LIST_MIN_WIDTH, listMinWidth } from "./settings-data";
import type { WysiwygSettings } from "./settings-data";

export { DEFAULT_SETTINGS } from "./settings-data";
export type { WysiwygSettings } from "./settings-data";

type ToggleKey = { [K in keyof WysiwygSettings]: WysiwygSettings[K] extends boolean ? K : never }[keyof WysiwygSettings];
/** Adds one setting to a group. */
type Add = (build: (setting: Setting) => void) => void;

export class WysiwygSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WysiwygPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    const { settings } = this.plugin;

    const sidebar = this.group("Sidebar");
    this.toggle(
      sidebar,
      "showActionRow",
      "Action buttons",
      "The Note button and the round buttons at the top of the sidebar. A round button that's off moves into the ⋯ menu. " +
        "With all of them off, what they do stays on the + buttons and in the commands.",
      true
    );
    // The round buttons only matter while the row shows.
    if (settings.showActionRow) {
      this.toggle(sidebar, "showSearchButton", "Search button", "Search everywhere.");
      this.toggle(sidebar, "showDailyNoteButton", "Daily note button", "Opens today's daily note. Needs the Daily notes core plugin.");
      this.toggle(sidebar, "showNewFolderButton", "New folder button");
      if (settings.tasks) this.toggle(sidebar, "showNewTaskButton", "New task button");
      this.toggle(sidebar, "showMoreButton", "⋯ button", "New tag, canvas and boards, templates, Obsidian search, import, expand or collapse all.");
    }
    this.toggle(
      sidebar,
      "hoverPreviews",
      "Preview on hover",
      "Rest the mouse on a note card or a task to preview the note. Uses the core Page preview plugin, whose settings can require Cmd/Ctrl."
    );
    sidebar((setting) => {
      setting
        .setName("Gaps around the note list")
        .setDesc("Top, bottom, left, right: each side that's on keeps a gap from the window's edge, with rounded corners.");
      const sides = [
        ["listInsetTop", "Top"],
        ["listInsetBottom", "Bottom"],
        ["listInsetLeft", "Left"],
        ["listInsetRight", "Right"],
      ] as const;
      for (const [key, side] of sides) {
        setting.addToggle((toggle) =>
          toggle
            .setTooltip(side)
            .setValue(settings[key])
            .onChange(async (value) => {
              await this.plugin.updateSettings({ [key]: value });
            })
        );
      }
    });

    const menu = this.group("Side menu");
    this.corePluginPlace(menu, {
      key: "showDailyNotes",
      name: "Daily notes",
      plugin: "daily-notes",
      desc: "Lists your daily notes, with a + that opens today's.",
      folder: dailyNotesFolder(this.app),
    });
    this.corePluginPlace(menu, {
      key: "showTemplates",
      name: "Templates",
      plugin: "templates",
      desc: "Lists your templates: click one to edit it, or make a note from it.",
      folder: templateOptions(this.app).folder,
    });
    if (settings.boards) this.toggle(menu, "showBoardsRow", "Boards", "Lists every board in the vault, below Tasks.");
    this.toggle(
      menu,
      "showSavedSearches",
      "Filters",
      "A filter is a search you save: one click opens its list with the search filled in. They're listed after your bookmarks, " +
        "and a button beside a list's other buttons saves what's in its search field as one. Off hides both; your filters are kept."
    );

    const tasks = this.group("Tasks");
    this.toggle(
      tasks,
      "tasks",
      "Tasks",
      "The Tasks page in the side menu, the New task buttons, the done count on note cards, and tasks in Search everywhere. " +
        "Off: all of that is hidden. Your tasks stay in your notes, untouched.",
      true
    );
    if (settings.tasks) tasks((setting) =>
      setting
        .setName("Default note for new tasks")
        .setDesc("Where the New task button and the + on Tasks add tasks. Leave empty to be asked the first time.")
        .addText((text) => {
          text.setPlaceholder("e.g. Tasks.md").setValue(settings.defaultTaskNote);
          text.onChange(async (value) => {
            await this.plugin.updateSettings({ defaultTaskNote: value.trim() });
          });
          new NoteSuggest(this.app, text.inputEl, async (file) => {
            await this.plugin.updateSettings({ defaultTaskNote: file.path });
          });
        })
    );
    if (settings.tasks && settings.boards) {
      this.toggle(
        tasks,
        "boardCardsInTasks",
        "Board cards as tasks",
        "A board saves each card as a checkbox line, so cards look like tasks. On: every card is also listed among your tasks. " +
          "Off: cards show on the Tasks page only when it's grouped by board."
      );
    }

    const boards = this.group("Boards");
    this.toggle(
      boards,
      "boards",
      "Boards",
      "Plainsight's own boards, opened on their own page or embedded in a note and edited there, and boards made with the Kanban plugins. " +
        "Off: a board is listed like any other note, its cards are ordinary tasks, and an embedded board shows as plain text.",
      true
    );
    if (settings.boards) {
      this.toggle(
        boards,
        "kanbanBoards",
        "Kanban plugin boards",
        "Shown as boards, and embeddable like Plainsight's own. Without that plugin, Plainsight opens them itself. " +
          "Off: listed like any other note."
      );
      this.toggle(
        boards,
        "taskListBoards",
        "Task List Kanban boards",
        "Shown as boards. They gather tasks from other notes, so they have no lists or cards to show or embed. " +
          "Off: listed like any other note."
      );
      boards((setting) =>
        setting
          .setName("Narrowest list")
          .setDesc(
            "How narrow a list on a board may get, in pixels, before the board scrolls sideways. " +
              "Lists are up to 240 wide when there's room, or this width if it's more."
          )
          .addSlider((slider) =>
            slider
              .setLimits(LIST_MIN_WIDTH.min, LIST_MIN_WIDTH.max, LIST_MIN_WIDTH.step)
              .setValue(listMinWidth(settings))
              .setDynamicTooltip()
              .onChange(async (value) => {
                await this.plugin.updateSettings({ boardListMinWidth: value });
              })
          )
      );
    }

    const editor = this.group("Editor (beta)");
    this.toggle(
      editor,
      "enabled",
      "WYSIWYG editing",
      "Hides Markdown syntax for good and formats with shortcuts, in every open note. Still being built: some Markdown isn't drawn yet. " +
        "It never changes what's in your files, so turning it off gives you plain Obsidian back at once.",
      true
    );
    if (settings.enabled) {
      this.toggle(
        editor,
        "takeOverRendering",
        "Let Plainsight draw everything (Source mode)",
        "Switches notes from Live Preview to Source mode, so Plainsight alone draws them. " +
          "Callouts then stay boxed while you edit them instead of turning back into Markdown. " +
          "What Plainsight doesn't draw yet (lists, tables, embeds, properties) shows as plain " +
          "Markdown until it does. Turning this off brings back the mode you had."
      );
    }
    editor((setting) =>
      setting
        .setName("Hotkeys")
        .setDesc(
          "Bold, italic, inline code and headings have keys already. Search everywhere, Open notes sidebar " +
            "and Toggle WYSIWYG editing have none until you give them one."
        )
        .addButton((button) => button.setButtonText("Set hotkeys").onClick(() => openHotkeys(this.app, "Plainsight")))
    );
  }

  /**
   * A titled group of settings: Obsidian's grouped look where it has one
   * (1.11 on), a heading and plain rows before that.
   */
  private group(heading: string): Add {
    if (typeof SettingGroup === "function") {
      const group = new SettingGroup(this.containerEl).setHeading(heading);
      return (build) => void group.addSetting(build);
    }
    new Setting(this.containerEl).setName(heading).setHeading();
    return (build) => build(new Setting(this.containerEl));
  }

  /** An on/off setting. `redraw`: other settings show or hide with it. */
  private toggle(add: Add, key: ToggleKey, name: string, desc = "", redraw = false): void {
    add((setting) =>
      setting
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
            await this.plugin.updateSettings({ [key]: value });
            if (redraw) this.display();
          })
        )
    );
  }

  /**
   * Daily notes or Templates: whether its row shows in the side menu, and
   * where it stands with its core plugin (off, no folder yet, or the
   * folder), with a button to fix or change that.
   */
  private corePluginPlace(
    add: Add,
    place: { key: "showDailyNotes" | "showTemplates"; name: string; plugin: string; desc: string; folder: string | null }
  ): void {
    const { key, name, plugin, desc, folder } = place;
    add((setting) => {
      setting.setName(name);
      if (!corePluginEnabled(this.app, plugin)) {
        setting
          .setDesc(`${desc} The ${name} core plugin is off: turn it on to see the row.`)
          .addButton((button) => button.setButtonText("Core plugins").onClick(() => openSettingsTab(this.app, "plugins")));
      } else if (!folder) {
        setting.setDesc(`${desc} No folder is set yet in the ${name} core plugin.`).addButton((button) =>
          button
            .setButtonText("Choose folder")
            .setCta()
            .onClick(() => openSettingsTab(this.app, plugin))
        );
      } else {
        setting
          .setDesc(`${desc} Folder: ${folder}, listed here instead of under Folders.`)
          .addButton((button) => button.setButtonText("Change folder").onClick(() => openSettingsTab(this.app, plugin)));
      }
      setting.addToggle((toggle) =>
        toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
          await this.plugin.updateSettings({ [key]: value });
        })
      );
    });
  }
}
