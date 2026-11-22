/* Geometry and text for a canvas's map on its card. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the line from `a`'s centre to `b`'s centre leaves `a`. */
function exit(a: Box, b: Box): [number, number] {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = b.x + b.w / 2 - cx;
  const dy = b.y + b.h / 2 - cy;
  if (!dx && !dy) return [cx, cy];
  // The fraction of the way to b's centre at which the line meets a's nearer side.
  const t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** A line between two boxes, from edge to edge rather than through them. */
export function edgeEnds(a: Box, b: Box): [number, number, number, number] {
  return [...exit(a, b), ...exit(b, a)];
}

/**
 * `text` in at most `lines` lines of at most `perLine` characters, broken
 * between words; "…" where it doesn't fit, or where a word is longer than a line.
 */
export function wrapLabel(text: string, perLine: number, lines: number): string[] {
  if (perLine < 1 || lines < 1) return [];
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = line ? `${line} ${word}` : word;
    if (next.length <= perLine) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
    if (out.length === lines) {
      // No room left: the last line ends in "…".
      const last = out[lines - 1];
      out[lines - 1] = `${last.slice(0, perLine - 1).trimEnd()}…`;
      return out;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = `${out[lines - 1].slice(0, perLine - 1).trimEnd()}…`;
  }
  return out;
}
