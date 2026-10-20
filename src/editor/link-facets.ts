import { EditorState, Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { LinkInfo } from "./links";

/*
 * Obsidian-backed link services, supplied by main.ts via facets so the
 * decoration code never imports `obsidian` and stays node-testable.
 */

/** Whether a vault link resolves to an existing file (false → dashed style). */
export type LinkResolver = (state: EditorState, target: string) => boolean;
export const linkResolver = Facet.define<LinkResolver, LinkResolver | null>({
  combine: (values) => values[0] ?? null,
});

/** Open a link; `split` asks for a pane to the right. */
export type LinkOpener = (view: EditorView, link: LinkInfo, split: boolean) => void;
export const linkOpener = Facet.define<LinkOpener, LinkOpener | null>({
  combine: (values) => values[0] ?? null,
});
