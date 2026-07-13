import { Plugin } from "obsidian";

export default class WysiwygPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("wysiwyg-editor loaded");
  }
}
