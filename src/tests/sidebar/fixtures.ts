import { NoteSummary } from "../../sidebar/core/types";

/** A NoteSummary with sensible defaults; override any field. */
export function note(path: string, over: Partial<NoteSummary> = {}): NoteSummary {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return {
    path,
    title: path.split("/").pop()!.replace(/\.md$/, ""),
    folder,
    tags: [],
    pinned: false,
    mtime: 0,
    ctime: 0,
    snippet: "",
    tasks: [],
    thumbnail: null,
    searchText: path.toLowerCase(),
    extracted: false,
    sourceLink: null,
    ...over,
  };
}
