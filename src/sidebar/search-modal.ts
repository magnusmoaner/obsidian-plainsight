import { App, Keymap, prepareSimpleSearch, renderMatches, setIcon, SuggestModal, TFile } from "obsidian";
import type { AttachmentFile } from "./core/attachments";
import { formatSize } from "./core/attachments";
import { cardDate, dueDateLabel, localISODate } from "./core/format";
import type { TaskRow } from "./core/queries";
import { omnisearch } from "./internals";
import {
  excerpt,
  filtersOnly,
  matchAttachment,
  matchNote,
  nameScore,
  parseQuery,
  rankNotes,
  rankTasks,
  SearchQuery,
  toObsidianQuery,
  toOmnisearchQuery,
  toTasksQuery,
} from "./core/search";
import { taskDetails } from "./core/task-details";
import { PRIORITIES } from "./core/task-line";
import { isClosed, NoteSummary } from "./core/types";

/** What Search everywhere searches, and how it opens what's found; the sidebar provides it. */
export interface SearchSource {
  notes(): NoteSummary[];
  /** Every task (open and done), as the Tasks page would list them. */
  taskRows(): TaskRow[];
  /** Attachments with their extracted text (lower-cased) and the note holding it. */
  attachments(): Array<{ file: AttachmentFile; extracted: string; companion: string | null }>;
  folders(): string[];
  tags(): string[];
  openNote(path: string, newTab: boolean): void;
  openTask(row: TaskRow, newTab: boolean): void;
  openAttachment(path: string, newTab: boolean): void;
  openFolder(path: string): void;
  openTag(tag: string): void;
  /** Show a place in the sidebar with this text in its Filter. */
  showInList(list: "notes" | "tasks" | "attachments", filter: string): void;
  obsidianSearch(query: string): void;
  /** Whether the Tasks plugin is enabled, so a query block would work. */
  tasksAvailable(): boolean;
  /** Put a Tasks query block into the note being edited. */
  insertTasksQuery(block: string): void;
}

type Excerpt = ReturnType<typeof excerpt>;
type Item = { group?: string } & (
  | { kind: "note"; note: NoteSummary; excerpt: Excerpt }
  | { kind: "task"; row: TaskRow }
  | { kind: "attachment"; file: AttachmentFile; excerpt: Excerpt }
  | { kind: "folder"; path: string }
  | { kind: "tag"; tag: string }
  | { kind: "more"; list: "notes" | "tasks" | "attachments"; count: number }
  | { kind: "obsidian"; query: string }
  | { kind: "tasks-query"; block: string }
);

const SHOWN = { notes: 8, tasks: 5, attachments: 5, places: 3 };

/**
 * Search everywhere: tasks, notes, attachments (by name and extracted text),
 * folders and tags, in groups, with the same query language as the list's
 * Filter (core/search.ts). Each group links to its full list; anything
 * Obsidian's own search can express is one item away.
 */
export class SearchModal extends SuggestModal<Item> {
  private latest: Promise<Item[]> | null = null;
  private input = "";

  constructor(app: App, private source: SearchSource, initial = "") {
    super(app);
    this.limit = 100;
    this.modalEl.addClass("ps-search-modal");
    this.setPlaceholder("Search notes, tasks, attachments, folders and tags");
    this.emptyStateText = "No matches. Try #tag, path:folder, is:overdue, due:week or priority:high.";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: "⌘ ↵", purpose: "to open in a new tab" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    // Mod+Enter opens in a new tab, like the quick switcher.
    this.scope.register(["Mod"], "Enter", (evt) => {
      const chooser = (this as unknown as { chooser?: { useSelectedItem?(evt: KeyboardEvent): void } }).chooser;
      chooser?.useSelectedItem?.(evt);
      return false;
    });
    if (initial) this.inputEl.value = initial;
  }

  /** Results come from file reads (excerpts), so an older query can finish
   * after a newer one; whichever finishes, show the newest. */
  async getSuggestions(input: string): Promise<Item[]> {
    this.input = input;
    const run = this.search(input);
    this.latest = run;
    const items = await run;
    return run === this.latest ? items : this.latest;
  }

  private async search(input: string): Promise<Item[]> {
    const q = parseQuery(input);
    const notes = this.source.notes();
    if (q.empty) {
      const recent = [...notes].sort((a, b) => b.mtime - a.mtime).slice(0, SHOWN.notes);
      return recent.map((note, i) => ({ kind: "note", note, excerpt: null, group: i ? undefined : "Recent notes" }));
    }
    const today = localISODate();
    const items: Item[] = [];
    /** A labelled group, and a link to the full list when it holds more. */
    const group = (label: string, list: Item[], total: number, fullList?: "notes" | "tasks" | "attachments") => {
      list.forEach((item, i) => items.push(i === 0 ? { ...item, group: `${label} · ${total}` } : item));
      if (fullList && total > list.length) items.push({ kind: "more", list: fullList, count: total });
    };

    const rankedTasks = rankTasks(this.source.taskRows(), q, today);
    group("Tasks", rankedTasks.slice(0, SHOWN.tasks).map((row) => ({ kind: "task" as const, row })), rankedTasks.length, "tasks");

    // With Omnisearch installed, its ranking (fuzzy, and covering PDFs and
    // images through Text Extractor) orders the notes and attachments it
    // finds; the query's other filters still apply, and Plainsight's own
    // matches it missed follow.
    const omni = await this.omnisearch(q);
    const rest = filtersOnly(q);
    const ours = rankNotes(notes, q, today);
    const rankedNotes = omni
      ? [
          ...notes
            .filter((n) => omni.rank.has(n.path) && matchNote(n, rest, today))
            .sort((a, b) => omni.rank.get(a.path)! - omni.rank.get(b.path)!),
          ...ours.filter((n) => !omni.rank.has(n.path)),
        ]
      : ours;
    const noteItems = await Promise.all(
      rankedNotes.slice(0, SHOWN.notes).map(async (note) => ({
        kind: "note" as const,
        note,
        excerpt: (await this.excerptOf(note.path, q)) ?? omni?.excerpt(note.path) ?? null,
      }))
    );
    group(omni ? "Notes, ranked by Omnisearch" : "Notes", noteItems, rankedNotes.length, "notes");

    const files = this.source
      .attachments()
      .filter((a) => (omni?.rank.has(a.file.path) && matchAttachment(a.file, a.extracted, rest)) || matchAttachment(a.file, a.extracted, q))
      .map((a) => ({
        ...a,
        score: omni?.rank.has(a.file.path)
          ? 1000 - omni.rank.get(a.file.path)!
          : nameScore(a.file.name.replace(/\.[^.]+$/, ""), q) + (a.extracted ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || b.file.mtime - a.file.mtime);
    const fileItems = await Promise.all(
      files.slice(0, SHOWN.attachments).map(async (a) => ({
        kind: "attachment" as const,
        file: a.file,
        excerpt: (a.companion ? await this.excerptOf(a.companion, q) : null) ?? omni?.excerpt(a.file.path) ?? null,
      }))
    );
    group("Attachments", fileItems, files.length, "attachments");

    // Folders and tags by name, for words (and #tags) typed.
    const words = [...q.words, ...q.phrases];
    const places: Item[] = [];
    if (words.length) {
      for (const path of this.source.folders()) {
        if (words.every((w) => path.toLowerCase().includes(w))) places.push({ kind: "folder", path });
      }
    }
    for (const tag of this.source.tags()) {
      const t = tag.toLowerCase();
      if ((words.length && words.every((w) => t.includes(w))) || q.tags.some((w) => t === w || t.startsWith(w))) {
        places.push({ kind: "tag", tag });
      }
    }
    const placeName = (p: Item) => (p.kind === "folder" ? p.path.split("/").pop()! : p.kind === "tag" ? p.tag : "");
    places.sort((a, b) => nameScore(placeName(b), q) - nameScore(placeName(a), q));
    group("Folders and tags", places.slice(0, SHOWN.places), places.length);

    // Elsewhere: Obsidian's own search, and the query saved as a Tasks block.
    const elsewhere: Item[] = [];
    const obsidian = toObsidianQuery(q);
    if (obsidian) elsewhere.push({ kind: "obsidian", query: obsidian });
    if (this.source.tasksAvailable()) elsewhere.push({ kind: "tasks-query", block: toTasksQuery(q, input) });
    elsewhere.forEach((item, i) => items.push(i === 0 ? { ...item, group: "Elsewhere" } : item));
    return items;
  }

  /** Omnisearch's results for the query's words, if it's installed: each
   * path's rank, and its excerpt as plain text. */
  private async omnisearch(
    q: SearchQuery
  ): Promise<{ rank: Map<string, number>; excerpt(path: string): Excerpt } | null> {
    const api = omnisearch();
    const text = toOmnisearchQuery(q);
    if (!api || !q.words.length && !q.phrases.length) return null;
    try {
      const results = await api.search(text);
      // Nothing yet (it indexes in the background after startup): use
      // Plainsight's own ranking rather than claim Omnisearch's.
      if (!results.length) return null;
      const rank = new Map(results.map((r, i) => [r.path, i]));
      const found = new Map(results.map((r) => [r.path, r]));
      return {
        rank,
        // Its excerpt is HTML; show it as text, highlighting the words it matched.
        excerpt: (path) => {
          const result = found.get(path);
          const plain = result?.excerpt
            ? result.excerpt.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
            : "";
          if (!plain) return null;
          const lower = plain.toLowerCase();
          const highlights: Array<[number, number]> = [];
          for (const word of result!.foundWords ?? []) {
            const w = word.toLowerCase();
            if (!w) continue;
            for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) highlights.push([i, i + w.length]);
          }
          highlights.sort((a, b) => a[0] - b[0]);
          return { text: plain, highlights: highlights.filter((h, i) => i === 0 || h[0] >= highlights[i - 1][1]) };
        },
      };
    } catch {
      return null; // Omnisearch failed or isn't ready: Plainsight's own ranking stands
    }
  }

  private async excerptOf(path: string, q: SearchQuery): Promise<Excerpt> {
    if (!q.words.length && !q.phrases.length) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
      return excerpt(await this.app.vault.cachedRead(file), q);
    } catch {
      return null;
    }
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.addClass("ps-search-item");
    if (item.group) {
      // The heading goes before the item, not in it, so the item's highlight
      // covers only the item. The list is emptied on every update, headings
      // included; selection and clicks only follow .suggestion-item elements.
      const heading = createDiv({
        cls: `ps-search-group${item.kind === "obsidian" || item.kind === "tasks-query" ? " is-elsewhere" : ""}`,
        text: item.group,
      });
      const place = () => el.parentElement?.insertBefore(heading, el);
      if (el.parentElement) place();
      else window.requestAnimationFrame(place);
    }
    const row = el.createDiv("ps-search-row");
    const icon = row.createSpan("ps-search-icon");
    const body = row.createDiv("ps-search-body");
    const q = parseQuery(this.input);
    const words = [...q.phrases, ...q.words].join(" ");
    const title = (text: string) => {
      const el2 = body.createDiv("ps-search-title");
      renderMatches(el2, text, words ? prepareSimpleSearch(words)(text)?.matches ?? null : null);
    };
    const meta = (parts: string[]) => {
      const text = parts.filter(Boolean).join(" · ");
      if (text) body.createDiv({ cls: "ps-search-meta", text });
    };
    const quote = (e: Excerpt) => {
      if (e) renderMatches(body.createDiv("ps-search-excerpt"), e.text, e.highlights);
    };
    switch (item.kind) {
      case "note":
        setIcon(icon, item.note.kind === "board" ? "kanban" : item.note.kind === "canvas" ? "layout-dashboard" : "file-text");
        title(item.note.title);
        meta([item.note.folder, cardDate(item.note.mtime)]);
        quote(item.excerpt);
        break;
      case "task": {
        const { note, task } = item.row;
        const d = taskDetails(task.text);
        setIcon(icon, isClosed(task) ? "check-circle-2" : "circle");
        title(d.description || task.text);
        const due = d.due ?? task.due;
        const priority = PRIORITIES.find((p) => p.value === d.priority);
        meta([
          note.title,
          priority ? `${priority.label} priority` : "",
          due && !isClosed(task) ? `Due ${dueDateLabel(due, localISODate()).toLowerCase()}` : "",
        ]);
        break;
      }
      case "attachment":
        setIcon(icon, "paperclip");
        title(item.file.name);
        meta([item.file.folder, formatSize(item.file.size)]);
        quote(item.excerpt);
        break;
      case "folder":
        setIcon(icon, "folder");
        title(item.path);
        break;
      case "tag":
        setIcon(icon, "tag");
        title(`#${item.tag}`);
        break;
      case "more":
        // A compact link under its group, lined up with the titles above.
        el.addClass("ps-search-more", "is-compact");
        body.createDiv({ cls: "ps-search-title", text: `Show all ${item.count} ${item.list} in the list →` });
        break;
      case "obsidian":
        el.addClass("ps-search-more");
        setIcon(icon, "search");
        body.createDiv({ cls: "ps-search-title", text: "Show in Obsidian search" });
        body.createDiv({ cls: "ps-search-meta", text: item.query });
        break;
      case "tasks-query":
        el.addClass("ps-search-more");
        setIcon(icon, "list-checks");
        body.createDiv({ cls: "ps-search-title", text: "Insert as Tasks query" });
        body.createDiv({
          cls: "ps-search-meta",
          text: item.block.split("\n").filter((l) => l && !l.startsWith("```") && !l.startsWith("#")).join(" · "),
        });
        break;
    }
  }

  onChooseSuggestion(item: Item, evt: MouseEvent | KeyboardEvent): void {
    const newTab = Keymap.isModEvent(evt) !== false;
    switch (item.kind) {
      case "note":
        return this.source.openNote(item.note.path, newTab);
      case "task":
        return this.source.openTask(item.row, newTab);
      case "attachment":
        return this.source.openAttachment(item.file.path, newTab);
      case "folder":
        return this.source.openFolder(item.path);
      case "tag":
        return this.source.openTag(item.tag);
      case "more":
        return this.source.showInList(item.list, this.input);
      case "obsidian":
        return this.source.obsidianSearch(item.query);
      case "tasks-query":
        return this.source.insertTasksQuery(item.block);
    }
  }
}
