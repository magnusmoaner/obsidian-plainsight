import { Extension, Prec, RangeSet } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { BuiltDecorations, buildDecorations } from "./decorations";
import { markdownTree } from "./parser";
import { wysiwygKeymap } from "./edit-semantics";
import { linkOpener } from "./link-facets";
import { enclosingLink } from "./links";

class WysiwygView {
  decorations: DecorationSet = Decoration.none;
  hidden: DecorationSet = RangeSet.empty;

  constructor(view: EditorView) {
    this.compute(view);
  }

  update(update: ViewUpdate): void {
    // Never-reveal invariant: selection changes never affect rendering, so we
    // deliberately do NOT recompute on update.selectionSet.
    if (update.docChanged || update.viewportChanged) this.compute(update.view);
  }

  private compute(view: EditorView): void {
    const doc = view.state.doc;
    const parts: BuiltDecorations[] = [];
    // inlineMarksIn drops constructs that straddle the query window, so each
    // visible range must be expanded to whole-line boundaries or delimiters
    // would flash unhidden at viewport edges.
    let covered = -1; // end of the last line already queried
    for (const range of view.visibleRanges) {
      let from = doc.lineAt(range.from).from;
      const to = doc.lineAt(range.to).to;
      // Expansion can make adjacent ranges overlap on shared lines. Clip to
      // the next line start after `covered` (a line end, so covered + 1 is a
      // line start) so no line is queried — and no decoration emitted — twice.
      if (to <= covered) continue;
      if (from <= covered) from = covered + 1;
      parts.push(buildDecorations(view.state, from, to));
      covered = to;
    }
    // Build per visible range; RangeSet.join keeps it viewport-cheap.
    this.hidden = RangeSet.join(parts.map((p) => p.hidden));
    this.decorations = RangeSet.join(parts.map((p) => p.decorations));
  }
}

const decorationPlugin = ViewPlugin.fromClass(WysiwygView, {
  decorations: (v) => v.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of(
      // Pull the CURRENT hidden set from the live plugin instance; a captured
      // set would go stale after the first recompute.
      (view) => view.plugin(plugin)?.hidden ?? RangeSet.empty
    ),
});

/**
 * Cmd/Ctrl+click opens a link (Cmd+Opt opens it to the right); a plain
 * click just places the caret, so link text can be edited. Highest
 * precedence so Obsidian's own source-mode link handling doesn't also fire.
 */
const linkClicks = Prec.highest(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
      const open = view.state.facet(linkOpener);
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (!open || pos === null) return false;
      const link = enclosingLink(view.state, pos);
      if (!link) return false;
      event.preventDefault();
      open(view, link, event.altKey);
      return true;
    },
  })
);

export function wysiwyg(): Extension {
  // Returned as a flat array: CM6 deduplicates the StateField/keymap when the
  // host app also adds markdownTree explicitly.
  return [markdownTree, decorationPlugin, wysiwygKeymap, linkClicks];
}
