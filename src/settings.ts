import { App, PluginSettingTab, Setting } from "obsidian";
import { openHotkeys } from "./sidebar/internals";
import { NoteSuggest } from "./sidebar/modals";
import type WysiwygPlugin from "./main";

export { DEFAULT_SETTINGS } from "./settings-data";
export type { WysiwygSettings } from "./settings-data";

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
      .setName("Take over rendering (Source mode)")
      .setDesc(
        "Turns off Live Preview so Plainsight is the only renderer: callouts then stay " +
          "boxed while you edit them instead of turning back into Markdown. Anything " +
          "Plainsight doesn't draw yet (lists, tables, embeds, properties) shows as plain " +
          "Markdown until it does. Your previous editor mode comes back when this is turned off."
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

    new Setting(this.containerEl).setName("Sidebar: left column").setHeading();

    new Setting(this.containerEl)
      .setName("Show the action buttons")
      .setDesc(
        "The row of buttons at the top. Without it, everything they do is still there: " +
          "the + on Notes, Tasks, Folders and Tags, and the commands."
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.showActionRow).onChange(async (value) => {
          await this.plugin.updateSettings({ showActionRow: value });
          this.display();
        })
      );
    const rowOff = !settings.showActionRow;
    const buttons = [
      ["showNoteButton", "Note button", ""],
      ["showSearchButton", "Search button", "A round button that's off moves into the ⋯ menu."],
      ["showNewFolderButton", "New folder button", ""],
      ["showNewTaskButton", "New task button", ""],
      ["showMoreButton", "⋯ button", ""],
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

    new Setting(this.containerEl).setName("Sidebar: right column").setHeading();

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
            ? "The list of notes and tasks sits on a white panel. Choose the sides where it keeps " +
                "a gap from the window's edge; a side with a gap also gets rounded corners."
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
      .setDesc("Where the sidebar's New task adds tasks. Leave empty to be asked the first time.")
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
        "Bold, italic, inline code and headings have keys already. Search everywhere, " +
          "Open notes sidebar and Toggle WYSIWYG editing have none until you give them one."
      )
      .addButton((button) =>
        button.setButtonText("Set hotkeys").onClick(() => openHotkeys(this.app, "Plainsight"))
      );
  }
}
