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
import {
  buildTaskLine,
  duePresets,
  NewTask,
  Priority,
  PRIORITIES,
  RECURRENCES,
  TaskLineOptions,
} from "./core/task-line";

/*
 * Dialogs behind the sidebar's "+" buttons, built from Obsidian's own Modal
 * and suggest classes so they look and behave like native dialogs. New tasks
 * use QuickTaskModal, which covers the Tasks fields people use day to day.
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

/** The key hints under a picker, as in Obsidian's own Move dialog. */
const PICKER_KEYS = [
  { command: "↑↓", purpose: "to navigate" },
  { command: "↵", purpose: "to choose" },
  { command: "esc", purpose: "to dismiss" },
];

/** Fuzzy picker over notes, used once to choose where new tasks go. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, placeholder: string, private onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(placeholder);
    this.setInstructions(PICKER_KEYS);
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
  cta: HTMLButtonElement;
}

function dialog(modal: Modal, title: string, ctaLabel: string, submit: () => void): Dialog {
  modal.modalEl.addClass("ps-dialog");
  modal.titleEl.setText(title);
  const body = modal.contentEl.createDiv({ cls: "ps-dialog-body" });
  const error = modal.contentEl.createDiv({ cls: "ps-modal-error" });
  const footer = modal.contentEl.createDiv({ cls: "modal-button-container" });
  footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => modal.close());
  const cta = footer.createEl("button", { cls: "mod-cta", text: ctaLabel });
  cta.addEventListener("click", submit);
  return { body, error, cta };
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
    el: button,
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
    const row = d.body.createDiv({ cls: "ps-dialog-chips is-end" });
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

// "More details" stays open once opened, for the rest of the session.
let detailsOpen = false;

/**
 * New task: one line of text, then Due, Priority, Repeat and Note chips, and
 * Scheduled and Start under "More details", which expands in place. Writes
 * one line in the Tasks plugin's format, so it works with or without Tasks.
 */
export class QuickTaskModal extends Modal {
  private task: NewTask = { text: "" };

  constructor(
    app: App,
    private target: TFile,
    private today: string,
    tasks: TaskLineOptions,
    private onSubmit: (task: QuickTask) => void
  ) {
    super(app);
    this.task = { text: "", ...tasks };
  }

  onOpen(): void {
    const t = this.task;
    const today = this.today;
    const submit = () => {
      if (!t.text.trim()) return void d.error.setText("Describe the task.");
      if (t.recurrence && !t.due && !t.scheduled && !t.start) {
        return void d.error.setText("A repeating task needs a due, scheduled or start date.");
      }
      const line = buildTaskLine(t);
      if (!line) return void d.error.setText("Couldn't write that task.");
      this.close();
      this.onSubmit({ line, target: this.target });
    };
    const d = dialog(this, "New task", "Add task", submit);
    const input = dialogInput(d, { placeholder: "What needs doing?" }, (v) => {
      t.text = v;
      d.cta.disabled = !v.trim();
    }, submit);
    d.cta.disabled = true;
    const refocus = () => {
      d.error.setText("");
      input.focus();
    };

    /** A chip for one date field: quick presets, a date picker, and Clear. */
    const dateChip = (
      row: HTMLElement,
      icon: string,
      name: string,
      key: "due" | "scheduled" | "start"
    ) => {
      // Invisible; only opened through showPicker(), so kept out of the Tab order.
      const picker = row.createEl("input", { type: "date", cls: "ps-dialog-date", attr: { tabindex: "-1" } });
      const set = (date: string) => {
        t[key] = date || undefined;
        chip.set(date ? dateLabel(name, dueDateLabel(date, this.today)) : name, !!date);
        summarize();
        refocus();
      };
      picker.addEventListener("change", () => set(picker.value));
      const chip = dialogChip(row, icon, (evt) => {
        const menu = new Menu();
        for (const p of duePresets(this.today)) {
          menu.addItem((i) => i.setTitle(p.label).setChecked(t[key] === p.date).onClick(() => set(p.date)));
        }
        menu.addItem((i) =>
          i.setTitle("Pick a date…").onClick(() => {
            picker.value = t[key] ?? "";
            try {
              picker.showPicker();
            } catch {
              picker.addClass("is-shown");
              picker.focus();
            }
          })
        );
        if (t[key]) menu.addItem((i) => i.setTitle("Clear").onClick(() => set("")));
        showUnder(menu, evt);
      });
      chip.set(name, false);
    };

    const row = d.body.createDiv({ cls: "ps-dialog-chips" });
    dateChip(row, "calendar", "Due", "due");

    const priority = dialogChip(row, "flag", (evt) => {
      const menu = new Menu();
      for (const p of PRIORITIES) {
        menu.addItem((i) =>
          i.setTitle(`${p.emoji} ${p.label}`).setChecked(t.priority === p.value).onClick(() => setPriority(p.value))
        );
      }
      if (t.priority) menu.addItem((i) => i.setTitle("No priority").onClick(() => setPriority(undefined)));
      showUnder(menu, evt);
    });
    const setPriority = (value: Priority | undefined) => {
      t.priority = value;
      const p = PRIORITIES.find((x) => x.value === value);
      priority.set(p ? p.label : "Priority", !!p);
      refocus();
    };
    setPriority(undefined);

    const repeat = dialogChip(row, "repeat", (evt) => {
      const menu = new Menu();
      for (const r of RECURRENCES) {
        menu.addItem((i) => i.setTitle(capitalize(r)).setChecked(t.recurrence === r).onClick(() => setRepeat(r)));
      }
      if (t.recurrence) {
        menu.addSeparator();
        menu.addItem((i) =>
          i
            .setTitle("Count from when it's done")
            .setChecked(!!t.whenDone)
            .onClick(() => {
              t.whenDone = !t.whenDone;
              setRepeat(t.recurrence);
            })
        );
        menu.addItem((i) => i.setTitle("Don't repeat").onClick(() => setRepeat(undefined)));
      }
      showUnder(menu, evt);
    });
    const setRepeat = (value: string | undefined) => {
      t.recurrence = value;
      if (!value) t.whenDone = false;
      repeat.set(value ? `${capitalize(value)}${t.whenDone ? ", when done" : ""}` : "Repeat", !!value);
      refocus();
    };
    setRepeat(undefined);

    // Where this one task goes (the default note stays as it is).
    const note = dialogChip(row, "file-text", () => {
      new NotePickerModal(this.app, "Add this task to…", (file) => {
        this.target = file;
        note.set(file.basename, true);
        refocus();
      }).open();
    });
    note.el.addClass("ps-dialog-chip-end");
    note.set(this.target.basename, true);

    // More details: expands in place (a CSS grid-row transition).
    const toggle = d.body.createEl("button", { cls: "ps-dialog-disclosure" });
    setIcon(toggle.createSpan({ cls: "ps-dialog-disclosure-icon" }), "chevron-right");
    toggle.createSpan({ text: "More details" });
    // Collapsed with a date set: say so, so nothing is written unseen.
    const summary = toggle.createSpan({ cls: "ps-dialog-disclosure-summary" });
    function summarize() {
      const set = [
        t.scheduled ? dateLabel("Scheduled", dueDateLabel(t.scheduled, today)) : "",
        t.start ? dateLabel("Start", dueDateLabel(t.start, today)) : "",
      ].filter(Boolean);
      summary.setText(!detailsOpen && set.length ? `· ${set.join(", ")}` : "");
    }
    const details = d.body.createDiv({ cls: "ps-dialog-details" });
    const extra = details.createDiv({ cls: "ps-dialog-details-inner" }).createDiv({ cls: "ps-dialog-chips" });
    dateChip(extra, "calendar-clock", "Scheduled", "scheduled");
    dateChip(extra, "calendar-plus", "Start", "start");
    const show = (open: boolean) => {
      detailsOpen = open;
      toggle.toggleClass("is-open", open);
      details.toggleClass("is-open", open);
      // Collapsed chips leave the Tab order too.
      details.inert = !open;
      summarize();
    };
    toggle.addEventListener("click", () => {
      show(!detailsOpen);
      input.focus();
    });
    show(detailsOpen);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Open a chip's menu under the chip, also when it's activated by keyboard. */
function showUnder(menu: Menu, evt: MouseEvent): void {
  const el = evt.currentTarget instanceof HTMLElement ? evt.currentTarget : null;
  if (!el) return void menu.showAtMouseEvent(evt);
  const r = el.getBoundingClientRect();
  menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
}

/** "Due tomorrow", "Due in 3 days", "Due Oct 20": lowercase only the relative words. */
function dateLabel(name: string, label: string): string {
  return `${name} ${/^(Today|Tomorrow|Yesterday)$/.test(label) ? label.toLowerCase() : label}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
    this.setInstructions(PICKER_KEYS);
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

