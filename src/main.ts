import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor, Plugin } from "obsidian";
import { toggleCode, toggleEm, toggleStrong } from "./editor/commands";
import { wysiwyg } from "./editor/extension";
import { treeOf } from "./editor/parser";
import {
  DEFAULT_SETTINGS,
  WysiwygSettings,
  WysiwygSettingTab,
} from "./settings";

export default class WysiwygPlugin extends Plugin {
  settings!: WysiwygSettings;
  private extensions: Extension[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.refreshExtensions();
    this.registerEditorExtension(this.extensions);
    this.addSettingTab(new WysiwygSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-wysiwyg",
      name: "Toggle WYSIWYG editing",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
      },
    });

    // Palette commands; inside the editor the CM keymap (Mod+B/I/`) already
    // handles the hotkeys at higher precedence.
    this.addCommand({
      id: "toggle-strong",
      name: "Toggle bold",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, toggleStrong),
    });
    this.addCommand({
      id: "toggle-em",
      name: "Toggle italic",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, toggleEm),
    });
    this.addCommand({
      id: "toggle-code",
      name: "Toggle inline code",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, toggleCode),
    });

    this.addCommand({
      id: "dump-syntax-tree",
      name: "Dump syntax tree to console (debug)",
      editorCheckCallback: (checking, editor) =>
        this.withView(checking, editor, (cm) => {
          console.log(treeOf(cm.state).toString());
          return true;
        }),
    });
  }

  private withView(
    checking: boolean,
    editor: Editor,
    fn: (cm: EditorView) => boolean
  ): boolean {
    // editor.cm is Obsidian's undocumented-but-stable CM6 handle.
    const cm = (editor as Editor & { cm?: EditorView }).cm;
    if (!cm) return false;
    if (checking) return true;
    return fn(cm);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshExtensions();
  }

  private refreshExtensions(): void {
    // Mutate the registered array in place; updateOptions() makes all open
    // editors reconfigure with the new contents.
    this.extensions.length = 0;
    if (this.settings.enabled) this.extensions.push(wysiwyg());
    this.app.workspace.updateOptions();
  }
}
