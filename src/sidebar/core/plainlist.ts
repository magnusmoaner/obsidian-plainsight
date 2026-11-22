/*
 * The Plainlist plugin's file: a note marked `plainlist: true`, with an
 * "# Inbox" of to-dos and a "# Projects" section listing project notes,
 * grouped under headings that are its areas. Read the way Plainlist reads it.
 */

export interface PlainlistProject {
  /** The link as written, unresolved. */
  link: string;
  done: boolean;
  /** The area heading it's under, or null. */
  area: string | null;
  /** 0-based line in the file: a project line is a checkbox, but not a to-do. */
  line: number;
}

export interface Plainlist {
  projects: PlainlistProject[];
  areas: string[];
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const TASK = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[.\]/;
// Plainlist's own pattern: "- [ ] [[Project]]" or "- [Project](Project.md)", optionally done.
const PROJECT =
  /^[ \t]*[-*+][ \t]+(?:\[([ xX])\][ \t]+)?(?:\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\[[^\]]*\]\(<?([^)>]+)>?\))(?:[ \t]+\[done::[ \t]*\d{4}-\d{2}-\d{2}[ \t]*\])?[ \t]*$/;

/** Whether a note's properties mark it as Plainlist's file. */
export function isPlainlist(frontmatter: Record<string, unknown> | null | undefined): boolean {
  const mark = frontmatter?.plainlist;
  return mark === true || (typeof mark === "string" && mark.toLowerCase() === "true");
}

/** Projects and areas in Plainlist's file. An area is a heading under "# Projects" with no to-dos under it. */
export function parsePlainlist(text: string): Plainlist {
  const lines = text.split(/\r?\n/);
  const projects: PlainlistProject[] = [];
  const areas: { name: string; line: number }[] = [];
  let inProjects = false;
  let fence: string | null = null;
  // The heading being read under "# Projects", until a to-do shows it isn't an area.
  let heading: { name: string; line: number; area: boolean } | null = null;
  const close = () => {
    if (heading?.area) areas.push({ name: heading.name, line: heading.line });
    heading = null;
  };
  let start = 0;
  if (lines[0] === "---") start = lines.indexOf("---", 1) + 1 || lines.length;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      close();
      if (h[1].length === 1) inProjects = h[2].toLowerCase() === "projects";
      else if (inProjects) heading = { name: h[2], line: i, area: true };
      continue;
    }
    if (!inProjects) continue;
    const p = PROJECT.exec(line);
    if (p) {
      const link = p[2] ?? safeDecode(p[3]).replace(/\.md$/i, "");
      projects.push({ link, done: p[1] === "x" || p[1] === "X", area: null, line: i });
      continue;
    }
    if (heading && TASK.test(line)) heading.area = false;
  }
  close();
  // A project's area: the last area heading above it.
  for (const project of projects) project.area = areas.filter((a) => a.line < project.line).pop()?.name ?? null;
  return { projects, areas: areas.map((a) => a.name) };
}

function safeDecode(link: string): string {
  try {
    return decodeURI(link);
  } catch {
    return link;
  }
}
