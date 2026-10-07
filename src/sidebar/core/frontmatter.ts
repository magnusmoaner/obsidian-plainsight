/*
 * Shared, line-based access to a note's frontmatter for the text-level
 * edits (pin, tags). Never parses or re-serializes YAML: callers change
 * individual lines and everything else is written back byte for byte.
 */

const BOM = "﻿";
// The body group is optional so an empty block (`---\n---`) is still frontmatter.
const BLOCK = /^---(\r?\n)(?:([\s\S]*?)\r?\n)?---(?=\r?\n|$)/;

export interface Frontmatter {
  /** A leading byte-order mark, kept so the file round-trips exactly. */
  bom: string;
  eol: string;
  /** The YAML lines between the fences; edit in place. */
  lines: string[];
  /** Everything after the closing fence. */
  rest: string;
}

/** The note's frontmatter block, or null if it has none. */
export function readFrontmatter(text: string): Frontmatter | null {
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = text.slice(bom.length);
  const match = BLOCK.exec(body);
  if (!match) return null;
  const [block, eol, yaml = ""] = match;
  return { bom, eol, lines: yaml ? yaml.split(/\r?\n/) : [], rest: body.slice(block.length) };
}

export function writeFrontmatter(fm: Frontmatter): string {
  const yaml = fm.lines.length ? `${fm.lines.join(fm.eol)}${fm.eol}` : "";
  return `${fm.bom}---${fm.eol}${yaml}---${fm.rest}`;
}

/** Give a note without frontmatter a new block holding `lines`. */
export function prependFrontmatter(text: string, lines: string[]): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = text.slice(bom.length);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  return `${bom}---${eol}${lines.join(eol)}${eol}---${eol}${body}`;
}
