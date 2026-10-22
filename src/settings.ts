import { App, PluginSettingTab, Setting } from "obsidian";
import { explainMenuFailure, WRITING_TOOLS } from "./menu-items";
import { canUseMenus, checkMenuAccess, openPrivacySettings } from "./menu-runner";
import { openHotkeys } from "./sidebar/internals";
import { NoteSuggest } from "./sidebar/modals";
import type WysiwygPlugin from "./main";

export { DEFAULT_SETTINGS } from "./settings-data";
export type { WysiwygSettings } from "./settings-data";

export class WysiwygSettingTab extends PluginSettingTab {
  /** The last permission check's outcome, kept while the tab re-renders. */
  private menuAccess = "";

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

    if (canUseMenus()) this.menuSection();

    new Setting(this.containerEl).setName("Hotkeys").setHeading();

    new Setting(this.containerEl)
      .setName("Plainsight's commands")
      .setDesc(
        "Bold, italic, inline code and headings have keys already. Search everywhere, Open notes sidebar, " +
          "Toggle WYSIWYG editing and the menu commands have none until you give them one."
      )
      .addButton((button) =>
        button.setButtonText("Set hotkeys").onClick(() => openHotkeys(this.app, "Plainsight"))
      );
  }

  private menuSection(): void {
    const { settings } = this.plugin;

    new Setting(this.containerEl)
      .setName("Menu commands")
      .setDesc(
        "Turn items in the menu bar into commands, so you can give them a hotkey in Obsidian, " +
          "run them from the command palette or put them on a toolbar. Plainsight picks the menu item for you, " +
          "which macOS allows only once Obsidian has two permissions."
      )
      .setHeading();

    const access = new Setting(this.containerEl)
      .setName("Permissions")
      .setDesc(
        this.menuAccess ||
          "Obsidian needs to be allowed to control System Events (Automation) and to be turned on under " +
            "Accessibility. Check asks macOS for what's missing and opens the right page of System Settings."
      )
      .addButton((button) =>
        button.setButtonText("Check").onClick(async () => {
          button.setDisabled(true);
          access.setDesc("Checking… answer macOS if it asks.");
          const { failure, detail } = await checkMenuAccess();
          if (!failure) {
            this.menuAccess = "Both permissions are on. Menu commands are ready.";
          } else if (failure === "automation" || failure === "accessibility") {
            this.menuAccess = `${explainMenuFailure(failure, null)} System Settings is open there now; press Check again afterwards.`;
            openPrivacySettings(failure);
          } else {
            this.menuAccess = explainMenuFailure(failure, null, detail);
          }
          this.display();
        })
      );

    new Setting(this.containerEl)
      .setName("Writing Tools")
      .setDesc(
        "Apple Intelligence's Edit › Writing Tools as commands, named \"Writing Tools: Summarize\" and so on. " +
          "Select text in a note, then run one. Needs Apple Intelligence turned on."
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.writingToolsCommands).onChange(async (value) => {
          await this.plugin.updateSettings({ writingToolsCommands: value });
          this.display();
        })
      );
    const toolsOff = !settings.writingToolsCommands;
    for (const item of WRITING_TOOLS) {
      new Setting(this.containerEl)
        .setName(item)
        .setDisabled(toolsOff)
        .addToggle((toggle) =>
          toggle
            .setValue(settings.writingTools.includes(item))
            .setDisabled(toolsOff)
            .onChange(async (value) => {
              const chosen = this.plugin.settings.writingTools.filter((name) => name !== item);
              await this.plugin.updateSettings({ writingTools: value ? [...chosen, item] : chosen });
            })
        );
    }

    new Setting(this.containerEl)
      .setName("Other menu items")
      .setDesc(
        "One per line, from the menu bar down, with > between the levels, e.g. Window > Minimize. " +
          "Names must match the menu exactly, in your Mac's language."
      )
      .addTextArea((text) => {
        text.setPlaceholder("Window > Minimize").setValue(settings.menuCommands);
        text.inputEl.rows = 4;
        text.onChange(async (value) => {
          await this.plugin.updateSettings({ menuCommands: value });
        });
      });
  }
}
