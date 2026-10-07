import {
  ChangeSpec,
  EditorSelection,
  EditorState,
  Line,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { SyntaxNode } from "@lezer/common";
import { treeOf } from "./parser";
import {
  enclosingHeading,
  enclosingInlineMarks,
  InlineMark,
  InlineMarkType,
} from "./syntax";

const DELIM: Record<InlineMarkType, string> = {
  strong: "**",
  em: "*",
  code: "`",
};

/**
 * Innermost mark of `type` whose range contains [from, to]. Containment is
 * inclusive at both edges: the caret sits at `to` right after typing the
 * closing delimiter, and toggling there must still unformat.
 */
function enclosingMark(
  state: EditorState,
  type: InlineMarkType,
  from: number,
  to: number
): InlineMark | null {
  // Tree-walk lookup, not a line-scoped window: constructs can span lines.
  return (
    enclosingInlineMarks(state, from, to).find((m) => m.type === type) ?? null
  );
}

/**
 * Pure toggle: returns the transaction spec that toggles `type` formatting
 * around the main selection, or null when there is nothing to act on
 * (empty cursor in whitespace, no enclosing construct).
 */
export function toggleInlineSpec(
  state: EditorState,
  type: InlineMarkType
): TransactionSpec | null {
  const sel = state.selection.main;
  let { from, to } = sel;

  const existing = enclosingMark(state, type, from, to);
  if (existing) {
    return {
      changes: existing.delims.map((d) => ({ from: d.from, to: d.to })),
      userEvent: "delete.format",
    };
  }

  if (sel.empty) {
    const word = state.wordAt(sel.head);
    if (!word) return null;
    from = word.from;
    to = word.to;
  }

  const d = DELIM[type];
  return {
    changes: [
      { from, insert: d },
      { from: to, insert: d },
    ],
    selection: EditorSelection.range(from + d.length, to + d.length),
    userEvent: "input.format",
  };
}

// Block containers whose lines we refuse to turn into headings — prefixing
// `## ` inside a quote or list item produces garbage Markdown. Boring failure:
// the line is left exactly as it was. Lifted as M4/M5 land.
const NON_HEADING_BLOCKS = new Set([
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "CommentBlock",
  "LinkReference",
  "FrontMatter",
  "SetextHeading1",
  "SetextHeading2",
]);

function isConvertibleLine(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = treeOf(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (NON_HEADING_BLOCKS.has(node.name)) return false;
  }
  return true;
}

function headingChangesForLine(
  state: EditorState,
  line: Line,
  level: number
): ChangeSpec[] {
  // Up to three leading spaces are legal before an ATX marker.
  const indent = line.text.length - line.text.trimStart().length;
  const start = line.from + indent;

  const existing = enclosingHeading(state, start);
  if (existing) {
    // Re-applying the current level toggles back to a paragraph, matching the
    // inline marks' toggle idiom.
    if (level === 0 || level === existing.level) {
      return existing.delims.map((d) => ({ from: d.from, to: d.to }));
    }
    return [
      {
        from: existing.from,
        to: existing.from + existing.level,
        insert: "#".repeat(level),
      },
    ];
  }

  if (level === 0) return []; // already a paragraph
  if (!isConvertibleLine(state, start)) return [];
  return [{ from: start, insert: `${"#".repeat(level)} ` }];
}

/**
 * Pure heading command: set every line touched by the main selection to
 * `level` (0 = paragraph). Returns null when no line would change.
 */
export function setHeadingSpec(
  state: EditorState,
  level: number
): TransactionSpec | null {
  const sel = state.selection.main;
  const changes: ChangeSpec[] = [];
  const last = state.doc.lineAt(sel.to).number;
  for (let n = state.doc.lineAt(sel.from).number; n <= last; n++) {
    changes.push(...headingChangesForLine(state, state.doc.line(n), level));
  }
  if (!changes.length) return null;

  const changeSet = state.changes(changes);
  return {
    changes: changeSet,
    // assoc 1: a caret sitting at the line start must end up after the
    // inserted `## `, not before it — typing at the marker's left edge would
    // push text in front of the `#` and break the heading.
    selection: state.selection.map(changeSet, 1),
    userEvent: level === 0 ? "delete.format" : "input.format",
  };
}

function run(type: InlineMarkType) {
  return (view: EditorView): boolean => {
    const spec = toggleInlineSpec(view.state, type);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}

export const toggleStrong = run("strong");
export const toggleEm = run("em");
export const toggleCode = run("code");

export function setHeading(level: number) {
  return (view: EditorView): boolean => {
    const spec = setHeadingSpec(view.state, level);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}
