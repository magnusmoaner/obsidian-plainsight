import { EditorState } from "@codemirror/state";
import { SyntaxNode } from "@lezer/common";
import { treeOf } from "./parser";
import { TextSpan } from "./syntax";
import { readWiki } from "./wikilinks";

export type LinkKind = "markdown" | "wiki" | "url";

export interface LinkInfo {
  kind: LinkKind;
  from: number;
  to: number;
  /**
   * Text the user wrote (a markdown link's text, a wikilink's alias): shown
   * and editable in place. Null when the visible text is derived from the
   * target (unaliased wikilink, bare URL) — that is shown by a widget and is
   * atomic, since typing over it would change where the link points.
   */
  text: TextSpan | null;
  /** What a widget shows when `text` is null. */
  display: string;
  /** Link text to resolve/open: a URL, a vault path, or "Note#Heading". */
  target: string;
  external: boolean;
  /** evernote:/// links from imports can't be opened in Obsidian. */
  evernote: boolean;
  /** Syntax to hide (only when `text` is set; otherwise the whole range). */
  hidden: TextSpan[];
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** "github.com/…/obsidian-plainsight" — host plus the last path part. */
export function shortUrl(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:www\.)?([^/?#]+)([^?#]*)/i.exec(url);
  if (!m) return url;
  const host = m[1];
  const parts = m[2].split("/").filter(Boolean);
  if (!parts.length) return host;
  if (parts.length === 1) return `${host}/${parts[0]}`;
  return `${host}/…/${parts[parts.length - 1]}`;
}

function markdownLink(state: EditorState, node: SyntaxNode): LinkInfo | null {
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  // "[foo]" with no (url): ordinary bracketed text, not a link.
  if (!url || marks.length < 3) return null;
  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  const target = state.doc.sliceString(url.from, url.to);
  const evernote = /^evernote:/i.test(target);
  return {
    kind: "markdown",
    from: node.from,
    to: node.to,
    text: { from: textFrom, to: textTo },
    display: state.doc.sliceString(textFrom, textTo),
    target,
    external: SCHEME.test(target) && !evernote,
    evernote,
    hidden: [
      { from: node.from, to: textFrom },
      { from: textTo, to: node.to },
    ],
  };
}

function wikiLink(state: EditorState, node: SyntaxNode): LinkInfo {
  const w = readWiki(node, state.doc);
  const aliased = w.alias !== null && w.alias.trim() !== "";
  return {
    kind: "wiki",
    from: node.from,
    to: node.to,
    text: aliased ? { from: w.aliasFrom, to: w.aliasTo } : null,
    display: w.display,
    target: w.linktext,
    external: false,
    evernote: false,
    hidden: aliased
      ? [
          { from: node.from, to: w.aliasFrom },
          { from: w.aliasTo, to: node.to },
        ]
      : [],
  };
}

function urlLink(state: EditorState, node: SyntaxNode, outer: SyntaxNode): LinkInfo {
  const target = state.doc.sliceString(node.from, node.to);
  return {
    kind: "url",
    from: outer.from,
    to: outer.to,
    text: null,
    display: shortUrl(target),
    target,
    external: true,
    evernote: /^evernote:/i.test(target),
    hidden: [],
  };
}

function toLink(state: EditorState, node: SyntaxNode): LinkInfo | null {
  switch (node.name) {
    case "Link":
      return markdownLink(state, node);
    case "WikiLink":
      return wikiLink(state, node);
    case "Autolink": {
      const url = node.getChild("URL");
      return url ? urlLink(state, url, node) : null;
    }
    case "URL":
      // Bare URL (GFM autolink): only when not part of a Link/Image/Autolink.
      if (node.parent && ["Link", "Image", "Autolink"].includes(node.parent.name)) return null;
      return urlLink(state, node, node);
    default:
      return null;
  }
}

/** Links lying fully inside [from, to] (same whole-line window contract as inlineMarksIn). */
export function linksIn(state: EditorState, from: number, to: number): LinkInfo[] {
  const out: LinkInfo[] = [];
  treeOf(state).iterate({
    from,
    to,
    enter(node) {
      if (node.from < from || node.to > to) return;
      const link = toLink(state, node.node);
      if (link) {
        out.push(link);
        // A Link's URL child must not be reported again as a bare URL.
        if (node.name === "Link" || node.name === "Autolink" || node.name === "WikiLink") return false;
      }
    },
  });
  return out;
}

/** The link containing `pos` (edges inclusive), or null. */
export function enclosingLink(state: EditorState, pos: number): LinkInfo | null {
  const tree = treeOf(state);
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.from > pos || node.to < pos) continue;
      const link = toLink(state, node);
      if (link) return link;
    }
  }
  return null;
}
