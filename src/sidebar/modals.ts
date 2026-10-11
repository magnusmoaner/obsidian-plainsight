import {
  AbstractInputSuggest,
  App,
  FuzzySuggestModal,
  Menu,
  Modal,
  normalizePath,
  Notice,
  setIcon,
  TAbstractFile,
  TFile,
} from "obsidian";
import { folderNameError, normalizeTag } from "./core/edits";
import { dueDateLabel } from "./core/format";
import { buildTaskLine, duePresets, Priority, PRIORITIES } from "./core/task-line";

/*
 * Dialogs behind the sidebar's "+" buttons, built from Obsidian's own Modal
 * and suggest classes so they look and behave like native dialogs. New tasks
 * use QuickTaskModal; the Tasks plugin's full dialog is one click away.
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

/**
 * A note that can take appended task lines: Markdown and not a Kanban board
 * (a board's tasks are its cards; a line appended after its settings block
 * would land in the wrong place and be hidden from the Tasks page).
 */
export function canHoldTasks(app: App, file: TFile): boolean {
  if (file.extension !== "md") return false;
  return app.metadataCache.getFileCache(file)?.frontmatter?.["kanban-plugin"] === undefined;
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
      .filter((f) => canHoldTasks(this.app, f) && f.path.toLowerCase().includes(q))
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
    return this.app.vault.getMarkdownFiles().filter((f) => canHoldTasks(this.app, f));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

/*
 * Shared dialog layout: a full-width input, optional chips beneath it, an
 * error line, and Obsidian's standard button bar (Cancel, then the main
 * button on the right). No settings-style rows or dividers.
 */
interface Dialog {
  body: HTMLElement;
  error: HTMLElement;
  /** The left end of the button bar, for a secondary link. */
  footerStart: HTMLElement;
  cta: HTMLButtonElement;
}

function dialog(modal: Modal, title: string, ctaLabel: string, submit: () => void): Dialog {
  modal.modalEl.addClass("ps-dialog");
  modal.titleEl.setText(title);
  const body = modal.contentEl.createDiv({ cls: "ps-dialog-body" });
  const error = modal.contentEl.createDiv({ cls: "ps-modal-error" });
  const footer = modal.contentEl.createDiv({ cls: "modal-button-container" });
  const footerStart = footer.createDiv({ cls: "ps-dialog-footer-start" });
  footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => modal.close());
  const cta = footer.createEl("button", { cls: "mod-cta", text: ctaLabel });
  cta.addEventListener("click", submit);
  return { body, error, footerStart, cta };
}

/** A full-width text input; Enter submits, and it's focused on open. */
function dialogInput(
  d: Dialog,
  opts: { placeholder: string; value?: string; select?: boolean },
  onInput: (value: string) => void,
  submit: () => void
): HTMLInputElement {
  const input = d.body.createEl("input", {
    type: "text",
    cls: "ps-dialog-input",
    attr: { placeholder: opts.placeholder, spellcheck: "false" },
  });
  input.value = opts.value ?? "";
  input.addEventListener("input", () => {
    d.error.setText("");
    onInput(input.value);
  });
  input.addEventListener("keydown", (evt) => {
    // Leave Enter to an open suggestion list (it picks the suggestion).
    if (evt.key === "Enter" && !evt.isComposing && !evt.defaultPrevented) {
      evt.preventDefault();
      submit();
    }
  });
  window.setTimeout(() => {
    input.focus();
    if (opts.select) input.select();
  }, 0);
  return input;
}

/** A small rounded button under the input: an icon and the current value. */
function dialogChip(row: HTMLElement, icon: string, onClick: (evt: MouseEvent) => void) {
  const button = row.createEl("button", { cls: "ps-dialog-chip" });
  setIcon(button.createSpan({ cls: "ps-dialog-chip-icon" }), icon);
  const label = button.createSpan({ cls: "ps-dialog-chip-label" });
  button.addEventListener("click", onClick);
  return {
    set(text: string, active: boolean) {
      label.setText(text);
      button.toggleClass("is-set", active);
    },
  };
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
    const submit = () => {
      const problem = folderNameError(this.name);
      if (problem) return void d.error.setText(problem);
      const path = normalizePath(this.parent ? `${this.parent}/${this.name.trim()}` : this.name.trim());
      if (this.app.vault.getAbstractFileByPath(path)) return void d.error.setText("That folder already exists.");
      this.close();
      this.onCreate(path);
    };
    const d = dialog(this, "New folder", "Create", submit);
    const input = dialogInput(d, { placeholder: "Folder name" }, (v) => {
      this.name = v;
      d.cta.disabled = !v.trim();
    }, submit);
    d.cta.disabled = true;
    const row = d.body.createDiv({ cls: "ps-dialog-chips" });
    row.createSpan({ cls: "ps-dialog-chips-label", text: "in" });
    const chip = dialogChip(row, "folder", () => {
      new PickerModal(
        this.app,
        "Put the new folder in…",
        ["", ...this.folders],
        (f) => f || "(top level)",
        (f) => {
          this.parent = f;
          chip.set(f || "(top level)", true);
          input.focus();
        }
      ).open();
    });
    chip.set(this.parent || "(top level)", true);
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
    const submit = () => {
      const tag = normalizeTag(this.value);
      if (!tag) return void d.error.setText("Use letters, digits, - _ or / (no spaces), not only digits.");
      this.close();
      this.onSubmit(tag);
    };
    const d = dialog(this, "Add tag", "Add", submit);
    d.body.createDiv({ cls: "ps-dialog-subtitle", text: `To “${this.noteTitle}”` });
    const input = dialogInput(d, { placeholder: "Tag, e.g. work/client" }, (v) => {
      this.value = v;
      d.cta.disabled = !v.trim();
    }, submit);
    d.cta.disabled = true;
    new ListSuggest(this.app, input, () => this.existing);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface QuickTask {
  line: string;
  target: TFile;
}

/**
 * Quick-add for a task: one line of text plus Due, Priority and Note chips.
 * Writes a Tasks-format line, so it works with or without the Tasks plugin.
 * `onMore`, when given, hands over to Tasks' full dialog with the text typed.
 */
export class QuickTaskModal extends Modal {
  private text = "";
  private due = "";
  private priority: Priority | undefined;

  constructor(
    app: App,
    private target: TFile,
    private today: string,
    private onSubmit: (task: QuickTask) => void,
    private onMore?: (text: string, target: TFile) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const submit = () => {
      const line = buildTaskLine({ text: this.text, due: this.due || undefined, priority: this.priority });
      if (!line) return void d.error.setText("Describe the task.");
      this.close();
      this.onSubmit({ line, target: this.target });
    };
    const d = dialog(this, "New task", "Add task", submit);
    const input = dialogInput(d, { placeholder: "What needs doing?" }, (v) => {
      this.text = v;
      d.cta.disabled = !v.trim();
    }, submit);
    d.cta.disabled = true;
    const row = d.body.createDiv({ cls: "ps-dialog-chips" });

    // Due: presets in a menu, plus a native date picker.
    const picker = row.createEl("input", { type: "date", cls: "ps-dialog-date" });
    picker.addEventListener("change", () => setDue(picker.value));
    const due = dialogChip(row, "calendar", (evt) => {
      const menu = new Menu();
      for (const p of duePresets(this.today)) {
        menu.addItem((i) => i.setTitle(p.label).setChecked(this.due === p.date).onClick(() => setDue(p.date)));
      }
      menu.addItem((i) =>
        i.setTitle("Pick a date…").onClick(() => {
          picker.value = this.due;
          try {
            picker.showPicker();
          } catch {
            picker.addClass("is-shown");
            picker.focus();
          }
        })
      );
      if (this.due) menu.addItem((i) => i.setTitle("No due date").onClick(() => setDue("")));
      menu.showAtMouseEvent(evt);
    });
    const setDue = (date: string) => {
      this.due = date;
      due.set(date ? dueDateLabel(date, this.today) : "Due", !!date);
      input.focus();
    };
    setDue("");

    // Priority.
    const priority = dialogChip(row, "flag", (evt) => {
      const menu = new Menu();
      for (const p of PRIORITIES) {
        menu.addItem((i) =>
          i.setTitle(`${p.emoji} ${p.label}`).setChecked(this.priority === p.value).onClick(() => setPriority(p.value))
        );
      }
      if (this.priority) menu.addItem((i) => i.setTitle("No priority").onClick(() => setPriority(undefined)));
      menu.showAtMouseEvent(evt);
    });
    const setPriority = (value: Priority | undefined) => {
      this.priority = value;
      const p = PRIORITIES.find((x) => x.value === value);
      priority.set(p ? p.label : "Priority", !!p);
      input.focus();
    };
    setPriority(undefined);

    // Note: where this one task goes (the default stays as it is).
    const note = dialogChip(row, "file-text", () => {
      new NotePickerModal(this.app, "Add this task to…", (file) => {
        this.target = file;
        note.set(file.basename, true);
        input.focus();
      }).open();
    });
    note.set(this.target.basename, true);

    if (this.onMore) {
      const more = d.footerStart.createEl("a", { cls: "ps-dialog-link", text: "More options…", href: "#" });
      more.addEventListener("click", (evt) => {
        evt.preventDefault();
        this.close();
        this.onMore?.(this.text, this.target);
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Generic type-ahead picker over any list (e.g. "notes with tasks"). */
export class PickerModal<T> extends FuzzySuggestModal<T> {
  constructor(
    app: App,
    placeholder: string,
    private items: T[],
    private text: (item: T) => string,
    private onPick: (item: T) => void
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): T[] {
    return this.items;
  }

  getItemText(item: T): string {
    return this.text(item);
  }

  onChooseItem(item: T): void {
    this.onPick(item);
  }
}

/**
 * Rename a note, canvas, attachment or folder. Obsidian has no public rename
 * dialog, so this is a small one around the public fileManager.renameFile,
 * which also updates links to the file. The extension is kept.
 */
/**
 * Rename a note, canvas, attachment or folder. Obsidian has no public rename
 * dialog, so this is a small one around the public fileManager.renameFile,
 * which also updates links to the file. The extension is kept.
 */
export class RenameModal extends Modal {
  private name: string;

  constructor(app: App, private file: TAbstractFile) {
    super(app);
    this.name = file instanceof TFile ? file.basename : file.name;
  }

  onOpen(): void {
    const submit = () => {
      const name = this.name.trim();
      const problem = folderNameError(name);
      if (problem) return void d.error.setText(problem);
      const parent = this.file.parent && !this.file.parent.isRoot() ? `${this.file.parent.path}/` : "";
      // An extensionless file (LICENSE) must not gain a trailing dot.
      const ext = this.file instanceof TFile && this.file.extension ? `.${this.file.extension}` : "";
      const path = normalizePath(`${parent}${name}${ext}`);
      if (path === this.file.path) return void this.close();
      if (this.app.vault.getAbstractFileByPath(path)) return void d.error.setText("Something with that name already exists here.");
      this.close();
      this.app.fileManager
        .renameFile(this.file, path)
        .catch((err: Error) => new Notice(`Couldn't rename: ${err.message}`));
    };
    const d = dialog(this, this.file instanceof TFile ? "Rename" : "Rename folder", "Rename", submit);
    dialogInput(d, { placeholder: "Name", value: this.name, select: true }, (v) => {
      this.name = v;
      d.cta.disabled = !v.trim();
    }, submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

