import { EditorState, Range as RangeValue, RangeSet } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { InlineMarkType, inlineMarksIn } from "./syntax";

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
  const hidden: RangeValue<Decoration>[] = [];
  const all: RangeValue<Decoration>[] = [];
  for (const mark of inlineMarksIn(state, from, to)) {
    all.push(contentMark[mark.type].range(mark.from, mark.to));
    for (const d of mark.delims) {
      hidden.push(hideDelim.range(d.from, d.to));
      all.push(hideDelim.range(d.from, d.to));
    }
  }
  return {
    hidden: RangeSet.of(hidden, true),
    decorations: RangeSet.of(all, true),
  };
}
