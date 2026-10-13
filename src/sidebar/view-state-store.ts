import { App } from "obsidian";
import { parseViewState, ViewState } from "./core/view-state";

/** Obsidian scopes local storage keys to the vault. */
const KEY = "plainsight-view";

/**
 * The sidebar's per-device view state (see core/view-state.ts), kept in
 * Obsidian's vault-scoped local storage rather than data.json, so it never
 * syncs. On Obsidian before 1.8.7, which has no such storage, it lives in
 * memory and resets when Obsidian restarts.
 */
export class ViewStateStore {
  private value: ViewState;
  /** Whether this device has stored view state of its own. */
  private stored: boolean;

  constructor(private app: App) {
    const raw: unknown = this.supported() ? this.app.loadLocalStorage(KEY) : null;
    this.stored = raw !== null && raw !== undefined;
    this.value = parseViewState(raw);
  }

  get state(): Readonly<ViewState> {
    return this.value;
  }

  update(patch: Partial<ViewState>): void {
    this.value = parseViewState({ ...this.value, ...patch });
    this.stored = true;
    if (this.supported()) this.app.saveLocalStorage(KEY, this.value);
  }

  /** Earlier versions kept view state in data.json. Take it over once, on a
   * device that has none of its own yet. */
  adopt(legacy: Record<string, unknown> | null): void {
    if (!legacy || this.stored) return;
    this.update(legacy as Partial<ViewState>);
  }

  private supported(): boolean {
    return typeof this.app.loadLocalStorage === "function" && typeof this.app.saveLocalStorage === "function";
  }
}
