/**
 * OCR Extractor's boxes. The plugin writes a file's extracted text as a
 * folded callout right under the file's embed:
 *
 *     ![[scan.pdf]]
 *
 *     > [!ocr-extractor]- Extracted text
 *     > the text…
 *
 * The box belongs to the embed on the last non-blank line above it (the
 * plugin's own alreadyProcessed() check reads it the same way). Inside a
 * quote the box sits one quote level deeper than the embed.
 */

export interface OcrBox {
  /** The embed's link target, unresolved. */
  link: string;
  /** The extracted text, without the callout's quote marks. */
  text: string;
  /** 0-based line of the box's first line. */
  line: number;
}

const FENCE = /^\s*(```|~~~)/;
/** A box's first line; group 1 is the quote prefix outside the box. The
 * `[!summary]` form is what older versions wrote. */
export const OCR_BOX_HEADER = /^([\s>]*?)>\s?\[!(?:ocr-extractor\][+-]?|summary\]-\s*Extracted text)/i;
const EMBED = /!\[\[([^\]|#^]+)[^\]]*\]\]|!\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)/g;

export function ocrBoxes(text: string): OcrBox[] {
  const lines = text.split(/\r?\n/);
  const boxes: OcrBox[] = [];
  let embed: string | null = null; // last embed on the last non-blank line
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      embed = null;
      continue;
    }
    if (inFence) continue;
    const header = OCR_BOX_HEADER.exec(line);
    if (header && embed !== null) {
      const inner = `${header[1]}>`;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j].startsWith(inner); j++) {
        body.push(lines[j].slice(inner.length).replace(/^ /, ""));
      }
      boxes.push({ link: embed, text: body.join("\n").trim(), line: i });
      embed = null;
      i = j - 1;
      continue;
    }
    if (!/[^\s>]/.test(line)) continue; // blank, or blank inside a quote
    embed = lastEmbed(line);
  }
  return boxes;
}

function lastEmbed(line: string): string | null {
  let link: string | null = null;
  for (const m of line.matchAll(EMBED)) {
    if (m[1] !== undefined) link = m[1].trim();
    else {
      try {
        link = decodeURIComponent(m[2]);
      } catch {
        link = m[2];
      }
    }
  }
  return link;
}
