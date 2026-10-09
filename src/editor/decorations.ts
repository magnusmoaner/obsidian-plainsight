import { EditorState, Range as RangeValue, RangeSet } from "@codemirror/state";
import { Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { CalloutIconWidget } from "./callout";
import { linkResolver } from "./link-facets";
import { LinkInfo, linksIn } from "./links";
import {
  InlineMarkType,
  TextSpan,
  calloutsIn,
  headingsIn,
  inlineMarksIn,
} from "./syntax";

const hideDelim = Decoration.replace({});

const contentMark: Record<InlineMarkType, Decoration> = {
  strong: Decoration.mark({ class: "cm-wys-strong" }),
  em: Decoration.mark({ class: "cm-wys-em" }),
  code: Decoration.mark({ class: "cm-wys-code" }),
};

// Line rather than mark decorations: the whole line takes the heading's size,
// so an emptied heading (`# ` alone) keeps its height instead of collapsing.
const headingLine = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-wys-heading cm-wys-h${level}` })
);

// One decoration per line; CSS joins them into a continuous box (side borders
// throughout, top/bottom and radii on the end lines). This only ever renders
// while Obsidian has handed the source lines back, so it never competes with
// Obsidian's own cm-embed-block rendering of the same callout.
/** Shows a link whose visible text is derived from its target. */
class LinkTextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string, readonly title: string) {
    super();
  }

  eq(other: LinkTextWidget): boolean {
    return other.text === this.text && other.cls === this.cls && other.title === this.title;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.cls;
    el.textContent = this.text;
    if (this.title) el.title = this.title;
    return el;
  }

  // Let CodeMirror handle clicks (caret placement, Cmd+click open).
  ignoreEvent(): boolean {
    return false;
  }
}

function linkClass(state: EditorState, link: LinkInfo): string {
  const classes = ["cm-wys-link"];
  if (link.external) classes.push("is-external");
  if (link.evernote) classes.push("is-evernote");
  if (!link.external && !link.evernote) {
    const resolves = state.facet(linkResolver);
    if (resolves && !resolves(state, link.target)) classes.push("is-unresolved");
  }
  return classes.join(" ");
}

function linkTitle(link: LinkInfo): string {
  if (link.evernote) return "Evernote link (not in vault)";
  return link.target;
}

function calloutLine(type: string, first: boolean, last: boolean): Decoration {
  return Decoration.line({
    class: [
      "cm-wys-callout",
      `cm-wys-callout-${type}`,
      first ? "cm-wys-callout-first" : "",
      last ? "cm-wys-callout-last" : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

export interface BuiltDecorations {
  /** Replace decorations over delimiter tokens — also used as atomic ranges. */
  hidden: DecorationSet;
  /** Everything the view should render: hidden delimiters + content styling. */
  decorations: DecorationSet;
}

export function buildDecorations(
  state: EditorState,
  from: number,
  to: number
): BuiltDecorations {
  const all: RangeValue<Decoration>[] = [];
  const delims: TextSpan[] = [];
  // Spans that are atomic but must not get a plain hide decoration, because
  // something else already renders them (the callout widget).
  const atomicOnly: TextSpan[] = [];
  for (const callout of calloutsIn(state, from, to)) {
    all.push(
      Decoration.replace({
        widget: new CalloutIconWidget(callout.type),
      }).range(callout.tokenFrom, callout.titleFrom)
    );
    atomicOnly.push({ from: callout.tokenFrom, to: callout.titleFrom });
    delims.push(...callout.quoteMarks);

    const firstLine = state.doc.lineAt(callout.from).number;
    const lastLine = state.doc.lineAt(callout.to).number;
    for (let n = firstLine; n <= lastLine; n++) {
      all.push(
        calloutLine(callout.type, n === firstLine, n === lastLine).range(
          state.doc.line(n).from
        )
      );
    }
  }
  for (const link of linksIn(state, from, to)) {
    const cls = linkClass(state, link);
    const title = linkTitle(link);
    if (link.text) {
      // Text the user wrote stays editable; only the syntax around it hides.
      if (link.text.to > link.text.from) {
        all.push(Decoration.mark({ class: cls, attributes: { title } }).range(link.text.from, link.text.to));
      }
      delims.push(...link.hidden);
    } else {
      // Derived text (target name, shortened URL): a widget, atomic.
      all.push(
        Decoration.replace({ widget: new LinkTextWidget(link.display, cls, title) }).range(link.from, link.to)
      );
      atomicOnly.push({ from: link.from, to: link.to });
    }
  }
  for (const heading of headingsIn(state, from, to)) {
    const lineStart = state.doc.lineAt(heading.from).from;
    all.push(headingLine[heading.level - 1].range(lineStart));
    delims.push(...heading.delims);
  }
  for (const mark of inlineMarksIn(state, from, to)) {
    all.push(contentMark[mark.type].range(mark.from, mark.to));
    delims.push(...mark.delims);
  }
  // Coalesce touching/overlapping delimiter spans (e.g. ***x*** puts an em
  // delimiter flush against a strong delimiter). skipAtomicRanges only
  // relocates positions strictly inside a range, so an unmerged junction
  // would be a dead cursor stop.
  delims.sort((a, b) => a.from - b.from || a.to - b.to);
  const hidden: RangeValue<Decoration>[] = [];
  for (const d of delims) {
    const last = hidden[hidden.length - 1];
    if (last && d.from <= last.to) {
      if (d.to > last.to) {
        hidden[hidden.length - 1] = hideDelim.range(last.from, d.to);
      }
    } else {
      hidden.push(hideDelim.range(d.from, d.to));
    }
  }
  all.push(...hidden);
  // atomicOnly joins the caret-skipping set but not the rendered set; only the
  // positions matter to EditorView.atomicRanges, not the decoration values.
  const atomic = hidden.concat(
    atomicOnly.map((s) => hideDelim.range(s.from, s.to))
  );
  return {
    hidden: RangeSet.of(atomic, true),
    decorations: RangeSet.of(all, true),
  };
}
