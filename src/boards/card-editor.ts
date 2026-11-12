import { App, Component, Editor, TFile } from "obsidian";

/**
 * Obsidian's own Markdown editor, small enough to sit in a card. A card
 * typed in it gets what any note gets: link and tag completion, and other
 * plugins' suggestions, the Tasks plugin's dates and priorities among them.
 *
 * Obsidian has no public way to make one, so its editor class is taken from
 * an embed, as the Kanban plugin does. Every step is guarded: if this stops
 * working in some Obsidian version, cards fall back to a plain text box.
 */

interface EmbeddedEditor extends Component {
  editor: Editor;
  get(): string;
  set(value: string): void;
  destroy?(): void;
}
type EditorClass = new (app: App, el: HTMLElement, owner: object) => EmbeddedEditor;

type Internals = {
  embedRegistry?: { embedByExtension?: { md?: (ctx: object, file: TFile | null, subpath: string) => Loose } };
  workspace: { activeEditor: unknown; editorSuggest?: { currentSuggest?: unknown } };
};
type Loose = { load(): void; unload(): void; editable: boolean; showEditor(): void; editMode?: object };

let editorClass: EditorClass | null | undefined;

function resolveEditorClass(app: App): EditorClass | null {
  if (editorClass !== undefined) return editorClass;
  editorClass = null;
  try {
    const embed = (app as unknown as Internals).embedRegistry?.embedByExtension?.md?.({ app, containerEl: createDiv(), state: {} }, null, "");
    if (!embed) return null;
    embed.load();
    embed.editable = true;
    embed.showEditor();
    const base = Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode)).constructor as EditorClass;
    embed.unload();
    // The Tasks plugin asks the editor whether to offer its suggestions on a
    // line that isn't written as a task: a card's first line is one.
    editorClass = class extends base {
      showTasksPluginAutoSuggest(cursor: { line: number }): boolean {
        return cursor.line === 0;
      }
    };
  } catch {
    editorClass = null;
  }
  return editorClass;
}

export interface CardEditor {
  remove(): void;
}

/**
 * Open an editor for a card's text in `parent`. Enter saves (`enter`),
 * Shift+Enter adds a line, Escape cancels and leaving the editor saves
 * (`close`, with null for cancel). Null if Obsidian's editor can't be had.
 */
export function openCardEditor(
  app: App,
  parent: HTMLElement,
  file: TFile,
  value: string,
  on: { enter(value: string): void; close(value: string | null): void }
): CardEditor | null {
  const Class = resolveEditorClass(app);
  if (!Class) return null;
  const workspace = (app as unknown as Internals).workspace;
  const host = parent.createDiv("psb-input psb-editor");
  let editor: EmbeddedEditor;
  // What an editor expects of the view that holds it; `file` is what suggestions are offered for.
  const owner: Record<string, unknown> = { app, file, onMarkdownScroll() {}, getMode: () => "source" };
  try {
    editor = new Class(app, host, owner);
    owner.editMode = editor;
    owner.editor = editor.editor;
    editor.load();
    editor.set(value);
  } catch {
    host.remove();
    editorClass = null; // don't try again this session
    return null;
  }

  const suggesting = () => !!workspace.editorSuggest?.currentSuggest;
  const before = workspace.activeEditor;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    if (workspace.activeEditor === owner) workspace.activeEditor = before;
    try {
      editor.unload();
      editor.destroy?.();
    } catch {
      // Already gone with its DOM.
    }
    host.remove();
  };

  // Capture: before the editor's own keys. While a suggestion list is open,
  // Enter and Escape belong to it.
  host.addEventListener(
    "keydown",
    (evt) => {
      if (suggesting() || evt.isComposing) return;
      if (evt.key === "Escape") {
        evt.preventDefault();
        evt.stopPropagation();
        on.close(null);
      } else if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        on.enter(editor.get());
      }
    },
    true
  );
  host.addEventListener("focusin", () => (workspace.activeEditor = owner));
  host.addEventListener("focusout", () => {
    // Picking a suggestion with the mouse takes the focus for a moment.
    window.setTimeout(() => {
      if (removed || suggesting() || host.contains(host.ownerDocument.activeElement)) return;
      on.close(editor.get());
    }, 100);
  });

  editor.editor.focus();
  const last = editor.editor.lastLine();
  editor.editor.setCursor({ line: last, ch: editor.editor.getLine(last).length });
  return { remove };
}
