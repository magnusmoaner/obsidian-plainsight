import { EditorState, Facet, TransactionSpec } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { enclosingCallout } from "./syntax";

/**
 * Opens the type picker. Supplied by main.ts via the facet below so this file
 * — and everything downstream of it in the decoration path — stays free of the
 * `obsidian` import and keeps running under the node test environment.
 */
export type CalloutMenu = (
  event: MouseEvent,
  current: string,
  choose: (type: string) => void
) => void;

export const calloutMenu = Facet.define<CalloutMenu, CalloutMenu | null>({
  combine: (values) => values[0] ?? null,
});

/** Obsidian's built-in callout types, the ones actually used in the vault
 * first. Aliases (`hint`, `cite`, `error`…) resolve to the same rendering, so
 * only the canonical name of each is offered. */
export const CALLOUT_TYPES = [
  "quote",
  "note",
  "info",
  "tip",
  "important",
  "check",
  "question",
  "warning",
  "caution",
  "failure",
  "danger",
  "bug",
  "example",
  "abstract",
  "todo",
] as const;

/** Rewrite `[!old]` to `[!next]` in place, leaving title and body untouched. */
export function setCalloutTypeSpec(
  state: EditorState,
  pos: number,
  type: string
): TransactionSpec | null {
  const callout = enclosingCallout(state, pos);
  if (!callout || callout.type === type) return null;
  return {
    changes: {
      from: callout.tokenFrom,
      to: callout.tokenFrom + callout.type.length + 3, // `[!` + type + `]`
      insert: `[!${type}]`,
    },
    userEvent: "input.format",
  };
}

/**
 * Replaces the `[!quote]` token. Doubles as the type picker: the token has to
 * be hidden anyway, so the icon that stands in for it is the natural place to
 * hang the menu rather than a separate corner button.
 */
export class CalloutIconWidget extends WidgetType {
  constructor(readonly type: string) {
    super();
  }

  eq(other: CalloutIconWidget): boolean {
    return other.type === this.type;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = `cm-wys-callout-icon cm-wys-callout-${this.type}`;
    el.setAttribute("aria-label", `Callout: ${this.type} (click to change)`);
    el.textContent = "▾";

    el.addEventListener("mousedown", (event) => {
      const open = view.state.facet(calloutMenu);
      if (!open) return;
      // Keep the click from moving the caret into the hidden token.
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(el);
      open(event, this.type, (type) => {
        const spec = setCalloutTypeSpec(view.state, pos, type);
        if (spec) view.dispatch(spec);
      });
    });
    return el;
  }

  // Without this CodeMirror swallows the events before the listener runs.
  ignoreEvent(): boolean {
    return false;
  }
}
