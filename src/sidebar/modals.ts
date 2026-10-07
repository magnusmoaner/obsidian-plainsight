import {
  AbstractInputSuggest,
  App,
  FuzzySuggestModal,
  Modal,
  normalizePath,
  Setting,
  TFile,
} from "obsidian";
import { folderNameError, normalizeTag } from "./core/edits";

/*
 * Dialogs behind the sidebar's "+" buttons, built from Obsidian's own Modal,
 * Setting and suggest classes so they look and behave like native dialogs.
 * Task creation normally doesn't come here at all: it reuses the Tasks
 * plugin's own dialog, and TaskModal is only the fallback without it.
 */

/** Type-ahead over a fixed list of strings, attached to a text input. */
class ListSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private input: HTMLInputElement, private items: () => string[]) {
    super(app, input);
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase().replace(/^#/, "");
    return this.items()
      .filter((item) => item.toLowerCase().includes(q))
      .slice(0, 50);
  }

  renderSuggestion(item: string, el: HTMLElement): void {
    el.setText(item);
  }

  selectSuggestion(item: string): void {
    this.input.value = item;
    this.input.trigger("input");
    this.close();
  }
}

/** Type-ahead over the vault's notes, for the default-task-note setting. */
export class NoteSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, private input: HTMLInputElement, private onPick: (file: TFile) => void) {
    super(app, input);
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.input.value = file.path;
    this.onPick(file);
    this.close();
  }
}

/** Fuzzy picker over notes, used once to choose where new tasks go. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, placeholder: string, private onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

function addButtons(modal: Modal, label: string, submit: () => void): void {
  new Setting(modal.contentEl)
    .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
    .addButton((b) => b.setButtonText(label).setCta().onClick(submit));
}

/** Enter submits from any text input in the dialog. */
function submitOnEnter(input: HTMLInputElement, submit: () => void): void {
  input.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" && !evt.isComposing) {
      evt.preventDefault();
      submit();
    }
  });
}

export class NotebookModal extends Modal {
  private name = "";
  private parent: string;

  constructor(
    app: App,
    private folders: string[],
    defaultParent: string,
    private onCreate: (path: string) => void
  ) {
    super(app);
    this.parent = defaultParent;
  }

  onOpen(): void {
    this.titleEl.setText("New notebook");
    const error = createDiv({ cls: "ps-modal-error" });
    const submit = () => {
      const problem = folderNameError(this.name);
      const path = normalizePath(this.parent ? `${this.parent}/${this.name.trim()}` : this.name.trim());
      if (problem) return void error.setText(problem);
      if (this.app.vault.getAbstractFileByPath(path)) return void error.setText("That notebook already exists.");
      this.close();
      this.onCreate(path);
    };
    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.onChange((v) => {
        this.name = v;
        error.setText("");
      });
      submitOnEnter(t.inputEl, submit);
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).setName("Inside").addDropdown((d) => {
      d.addOption("", "(top level)");
      for (const folder of this.folders) d.addOption(folder, folder);
      d.setValue(this.parent).onChange((v) => (this.parent = v));
    });
    this.contentEl.appendChild(error);
    addButtons(this, "Create", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TagModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private noteTitle: string,
    private existing: string[],
    private onSubmit: (tag: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Add tag");
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Adds the tag to "${this.noteTitle}". Tags in Obsidian exist through the notes that carry them.`,
    });
    const error = createDiv({ cls: "ps-modal-error" });
    const submit = () => {
      const tag = normalizeTag(this.value);
      if (!tag) return void error.setText("Use letters, digits, - _ or / (no spaces), not only digits.");
      this.close();
      this.onSubmit(tag);
    };
    new Setting(this.contentEl).setName("Tag").addText((t) => {
      t.setPlaceholder("e.g. work/client").onChange((v) => {
        this.value = v;
        error.setText("");
      });
      new ListSuggest(this.app, t.inputEl, () => this.existing);
      submitOnEnter(t.inputEl, submit);
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    this.contentEl.appendChild(error);
    addButtons(this, "Add", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Only used when the Tasks plugin's own dialog isn't available. */
export class TaskModal extends Modal {
  private text = "";
  private due = "";

  constructor(app: App, private onSubmit: (line: string) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("New task");
    const error = createDiv({ cls: "ps-modal-error" });
    const submit = () => {
      const text = this.text.trim();
      if (!text) return void error.setText("Describe the task.");
      this.close();
      // Tasks-plugin format, so the task is fully usable if Tasks is installed later.
      this.onSubmit(`- [ ] ${text}${this.due ? ` 📅 ${this.due}` : ""}`);
    };
    new Setting(this.contentEl).setName("Task").addText((t) => {
      t.onChange((v) => {
        this.text = v;
        error.setText("");
      });
      submitOnEnter(t.inputEl, submit);
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).setName("Due").addText((t) => {
      t.inputEl.type = "date";
      t.onChange((v) => (this.due = v));
    });
    this.contentEl.appendChild(error);
    addButtons(this, "Add", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
