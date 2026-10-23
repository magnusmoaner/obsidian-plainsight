import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import { openHotkeys, openSettingsTab, pluginInstalled } from "./sidebar/internals";
import { NoteSuggest } from "./sidebar/modals";
import type WysiwygPlugin from "./main";

export { DEFAULT_SETTINGS } from "./settings-data";
export type { WysiwygSettings } from "./settings-data";

const MENU_COMMANDS_ID = "plainsight-menu-commands";
const MENU_COMMANDS_URL = "https://github.com/magnusmoaner/obsidian-plainsight-menu-commands";

export class WysiwygSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WysiwygPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    const { settings } = this.plugin;

    new Setting(this.containerEl)
      .setName("Editor (beta, work in progress)")
      .setDesc(
        "The editor is in beta and still being built: some Markdown isn't drawn yet, and you may meet rough edges. " +
          "It changes how notes look and how keys behave, never what's in your files, " +
          "so turning it off gives you plain Obsidian back at once."
      )
      .setHeading();

    new Setting(this.containerEl)
      .setName("Enable WYSIWYG editing")
      .setDesc("Hide Markdown syntax for good and format with shortcuts. Applies to every open note.")
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          await this.plugin.updateSettings({ enabled: value });
          this.display();
        })
      );

    new Setting(this.containerEl)
      .setName("Let Plainsight draw everything (Source mode)")
      .setDesc(
        "Switches notes from Live Preview to Source mode, so Plainsight alone draws them. " +
          "Callouts then stay boxed while you edit them instead of turning back into Markdown. " +
          "What Plainsight doesn't draw yet (lists, tables, embeds, properties) shows as plain " +
          "Markdown until it does. Turning this off brings back the mode you had."
      )
      .setDisabled(!settings.enabled)
      .addToggle((toggle) =>
        toggle
          .setValue(settings.takeOverRendering)
          .setDisabled(!settings.enabled)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ takeOverRendering: value });
          })
      );

    new Setting(this.containerEl).setName("Notes sidebar: left column").setHeading();

    new Setting(this.containerEl)
      .setName("Action buttons")
      .setDesc(
        "The Note button and the round buttons beside it, at the top of the column. " +
          "Turned off, everything they do is still there: the + on Notes, Tasks, Folders and Tags, and the commands."
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.showActionRow).onChange(async (value) => {
          await this.plugin.updateSettings({ showActionRow: value });
          this.display();
        })
      );
    const rowOff = !settings.showActionRow;
    const intoMore = "Turned off, it moves into the ⋯ menu.";
    const buttons = [
      ["showSearchButton", "Search button", `Search everywhere. ${intoMore}`],
      ["showNewFolderButton", "New folder button", intoMore],
      ["showNewTaskButton", "New task button", intoMore],
      [
        "showMoreButton",
        "⋯ button",
        "New tag, canvas and boards, templates, Obsidian search, import, expand or collapse all.",
      ],
    ] as const;
    for (const [key, name, desc] of buttons) {
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(desc)
        .setDisabled(rowOff)
        .addToggle((toggle) =>
          toggle
            .setValue(settings[key])
            .setDisabled(rowOff)
            .onChange(async (value) => {
              await this.plugin.updateSettings({ [key]: value });
            })
        );
    }

    new Setting(this.containerEl).setName("Notes sidebar: right column").setHeading();

    new Setting(this.containerEl)
      .setName("Preview on hover")
      .setDesc(
        "Rest the mouse on a note card to preview the note, or on a task to preview its note at that task. " +
          "Uses the core Page preview plugin; its settings can require Cmd/Ctrl to be held."
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.hoverPreviews).onChange(async (value) => {
          await this.plugin.updateSettings({ hoverPreviews: value });
        })
      );

    const sides = [
      ["listInsetTop", "Gap at the top"],
      ["listInsetBottom", "Gap at the bottom"],
      ["listInsetLeft", "Gap on the left"],
      ["listInsetRight", "Gap on the right"],
    ] as const;
    for (const [key, name] of sides) {
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(
          key === "listInsetTop"
            ? "The list sits on a white panel. Turn on each side where it should keep a gap " +
                "from the window's edge; a side with a gap gets rounded corners."
            : ""
        )
        .addToggle((toggle) =>
          toggle.setValue(settings[key]).onChange(async (value) => {
            await this.plugin.updateSettings({ [key]: value });
          })
        );
    }

    new Setting(this.containerEl).setName("Tasks").setHeading();

    new Setting(this.containerEl)
      .setName("Default note for new tasks")
      .setDesc("Where the sidebar's New task button and the + on Tasks add tasks. Leave empty to be asked the first time.")
      .addText((text) => {
        text.setPlaceholder("e.g. Tasks.md").setValue(settings.defaultTaskNote);
        text.onChange(async (value) => {
          await this.plugin.updateSettings({ defaultTaskNote: value.trim() });
        });
        new NoteSuggest(this.app, text.inputEl, async (file) => {
          await this.plugin.updateSettings({ defaultTaskNote: file.path });
        });
      });

    new Setting(this.containerEl)
      .setName("List Kanban cards as tasks")
      .setDesc(
        "The Kanban plugin saves each card as a checkbox line, so cards look like tasks. " +
          "Off: cards stay on their board, and show on the Tasks page only when grouped by Kanban board. " +
          "On: every card is also listed among your tasks."
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.boardCardsInTasks).onChange(async (value) => {
          await this.plugin.updateSettings({ boardCardsInTasks: value });
        })
      );

    new Setting(this.containerEl).setName("Hotkeys").setHeading();

    new Setting(this.containerEl)
      .setName("Plainsight's commands")
      .setDesc(
        "Bold, italic, inline code and headings have keys already. Search everywhere, Open notes sidebar " +
          "and Toggle WYSIWYG editing have none until you give them one."
      )
      .addButton((button) =>
        button.setButtonText("Set hotkeys").onClick(() => openHotkeys(this.app, "Plainsight"))
      );

    // Hotkeys for Writing Tools come in a companion plugin: it needs macOS
    // system access, which would make Plainsight itself desktop-only.
    if (Platform.isMacOS && Platform.isDesktopApp) {
      const installed = pluginInstalled(this.app, MENU_COMMANDS_ID);
      new Setting(this.containerEl)
        .setName("Writing Tools and menu commands")
        .setDesc(
          "Hotkeys for Apple Intelligence's Writing Tools, and for any other menu item, come in a companion " +
            "plugin, Plainsight Menu Commands. It's separate because it needs access to macOS, which would " +
            "keep Plainsight itself off phones and tablets."
        )
        .addButton((button) =>
          installed
            ? button.setButtonText("Open its settings").onClick(() => openSettingsTab(this.app, MENU_COMMANDS_ID))
            : button.setButtonText("Learn more").onClick(() => window.open(MENU_COMMANDS_URL))
        );
    }
  }

}
