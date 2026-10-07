import { App, PluginSettingTab, Setting } from "obsidian";
import type WysiwygPlugin from "./main";

export interface WysiwygSettings {
  enabled: boolean;
  /** Force Source mode so this plugin is the only renderer. */
  takeOverRendering: boolean;
}

export const DEFAULT_SETTINGS: WysiwygSettings = {
  enabled: true,
  takeOverRendering: false,
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
  }
}
