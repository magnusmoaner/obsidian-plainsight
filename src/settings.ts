import { App, PluginSettingTab, Setting } from "obsidian";
import { NoteSuggest } from "./sidebar/modals";
import type WysiwygPlugin from "./main";

export interface WysiwygSettings {
  enabled: boolean;
  /** Force Source mode so this plugin is the only renderer. */
  takeOverRendering: boolean;
  /** Show the Plainsight notes sidebar. */
  sidebar: boolean;
  /** Width of the sidebar's nav column, in px. */
  sidebarNavWidth: number;
  /** Collapsed nav sections and tree nodes, e.g. "section:tags", "notebook:Inbox". */
  sidebarCollapsed: string[];
  /** Note that the sidebar's "+" on Tasks appends new tasks to; "" = ask. */
  defaultTaskNote: string;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
  takeOverRendering: false,
  sidebar: true,
  sidebarNavWidth: 200,
  sidebarCollapsed: [],
  defaultTaskNote: "",
};

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
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
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
            this.plugin.settings.takeOverRendering = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Notes sidebar")
      .setDesc(
        "A two-column sidebar: places (shortcuts, notes, tasks, templates, notebooks, tags) " +
          "and note cards. Turn off the core File explorer to use it in its place."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebar).onChange(async (value) => {
          this.plugin.settings.sidebar = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(this.containerEl)
      .setName("Default note for new tasks")
      .setDesc("Where the sidebar's + on Tasks adds new tasks. Leave empty to be asked the first time.")
      .addText((text) => {
        text.setPlaceholder("e.g. Tasks.md").setValue(this.plugin.settings.defaultTaskNote);
        text.onChange(async (value) => {
          this.plugin.settings.defaultTaskNote = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        });
        new NoteSuggest(this.app, text.inputEl, async (file) => {
          this.plugin.settings.defaultTaskNote = file.path;
          await this.plugin.saveData(this.plugin.settings);
        });
      });
  }
}
