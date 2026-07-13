import { EditorState, Range as RangeValue, RangeSet } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { InlineMarkType, TextSpan, inlineMarksIn } from "./syntax";

const hideDelim = Decoration.replace({});

const contentMark: Record<InlineMarkType, Decoration> = {
  strong: Decoration.mark({ class: "cm-wys-strong" }),
  em: Decoration.mark({ class: "cm-wys-em" }),
  code: Decoration.mark({ class: "cm-wys-code" }),
};

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
  return {
    hidden: RangeSet.of(hidden, true),
    decorations: RangeSet.of(all, true),
  };
}
