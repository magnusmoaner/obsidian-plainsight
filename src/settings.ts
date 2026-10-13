import { App, PluginSettingTab, Setting } from "obsidian";
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
    new Setting(this.containerEl)
      .setName("Enable WYSIWYG editing")
      .setDesc(
        "Hide Markdown syntax permanently and edit with hotkeys. Applies to all panes."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          await this.plugin.updateSettings({ enabled: value });
        })
      );

    new Setting(this.containerEl)
      .setName("Take over rendering (Source mode)")
      .setDesc(
        "Turns off Live Preview so this plugin is the only renderer — callouts " +
          "then stay boxed while you edit them instead of reverting to Markdown. " +
          "Anything this plugin does not render yet (lists, wikilinks, tables, " +
          "properties) shows as plain Markdown until it does. Your previous " +
          "Live Preview setting is restored when this is turned off."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.takeOverRendering)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ takeOverRendering: value });
          })
      );

    new Setting(this.containerEl)
      .setName("Notes sidebar")
      .setDesc(
        "A two-column sidebar: places (bookmarks, notes, tasks, attachments, templates, folders, tags) " +
          "and note cards. Turn off the core File explorer to use it in its place."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebar).onChange(async (value) => {
          await this.plugin.updateSettings({ sidebar: value });
        })
      );

    new Setting(this.containerEl)
      .setName("Default note for new tasks")
      .setDesc("Where the sidebar's + on Tasks adds new tasks. Leave empty to be asked the first time.")
      .addText((text) => {
        text.setPlaceholder("e.g. Tasks.md").setValue(this.plugin.settings.defaultTaskNote);
        text.onChange(async (value) => {
          await this.plugin.updateSettings({ defaultTaskNote: value.trim() });
        });
        new NoteSuggest(this.app, text.inputEl, async (file) => {
          await this.plugin.updateSettings({ defaultTaskNote: file.path });
        });
      });

    new Setting(this.containerEl)
      .setName("Show Kanban cards in Tasks")
      .setDesc("Kanban boards store cards as checkbox lines. Off: the Tasks page lists only real tasks.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.boardCardsInTasks).onChange(async (value) => {
          await this.plugin.updateSettings({ boardCardsInTasks: value });
        })
      );
  }
}
