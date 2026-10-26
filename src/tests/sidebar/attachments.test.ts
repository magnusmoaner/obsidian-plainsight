import { describe, expect, test } from "vitest";
import {
  AttachmentFile,
  attachmentFolderMatcher,
  attachmentsFor,
  formatSize,
  groupAttachments,
} from "../../sidebar/core/attachments";

describe("groupAttachments", () => {
  const file = (path: string, mtime = 0): AttachmentFile => {
    const name = path.split("/").pop()!;
    return {
      path,
      name,
      folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      extension: name.split(".").pop()!.toLowerCase(),
      size: 1,
      mtime,
      ctime: mtime,
    };
  };
  const files = [file("Work/b.PDF"), file("a.png"), file("Work/c.zip"), file("Home/d.jpg")];
  const shape = (by: "folder" | "type" | "none") =>
    groupAttachments(files, "title", by).map((g) => [g.label, g.notes.map((f) => f.name)]);

  test("by folder: vault root first, then by name", () => {
    expect(shape("folder")).toEqual([
      ["Vault root", ["a.png"]],
      ["Home", ["d.jpg"]],
      ["Work", ["b.PDF", "c.zip"]],
    ]);
  });

  test("by type: images, PDFs, then other files", () => {
    expect(shape("type")).toEqual([
      ["Images", ["a.png", "d.jpg"]],
      ["PDFs", ["b.PDF"]],
      ["Other files", ["c.zip"]],
    ]);
  });

  test("no grouping is one unlabelled group; nothing is no groups", () => {
    expect(shape("none")).toEqual([["", ["b.PDF", "a.png", "c.zip", "d.jpg"]]]);
    expect(groupAttachments([], "modified", "type")).toEqual([]);
  });
});

describe("attachmentFolderMatcher", () => {
  test("root and same-folder settings hide nothing", () => {
    for (const setting of ["/", "", "./", "."]) {
      expect(attachmentFolderMatcher(setting)("Attachments")).toBe(false);
    }
  });

  test("./Sub matches that subfolder anywhere, and below it", () => {
    const m = attachmentFolderMatcher("./Attachments");
    expect(m("Attachments")).toBe(true);
    expect(m("Work/Mail/Attachments")).toBe(true);
    expect(m("Work/Attachments/2026")).toBe(true);
    expect(m("Work/Old Attachments")).toBe(false);
    expect(m("Work")).toBe(false);
  });

  test("a fixed folder matches itself and its descendants only", () => {
    const m = attachmentFolderMatcher("Files/Media/");
    expect(m("Files/Media")).toBe(true);
    expect(m("Files/Media/x")).toBe(true);
    expect(m("Files")).toBe(false);
    expect(m("Other/Files/Media")).toBe(false);
  });
});

describe("attachmentsFor", () => {
  const file = (path: string, mtime: number): AttachmentFile => ({
    path,
    name: path.split("/").pop()!,
    folder: path.slice(0, path.lastIndexOf("/")),
    extension: path.split(".").pop()!,
    size: 1,
    mtime,
    ctime: mtime,
  });
  const files = [file("A/Attachments/brev.pdf", 1), file("A/Attachments/foto.jpg", 2)];
  const companions = new Map([["A/Attachments/brev.pdf", "brev om haveforeningens sommerfest"]]);
  const names = (list: AttachmentFile[]) => list.map((f) => f.name);

  test("newest first by default", () => {
    expect(names(attachmentsFor(files, companions, "", "modified"))).toEqual(["foto.jpg", "brev.pdf"]);
  });

  test("search matches the file name", () => {
    expect(names(attachmentsFor(files, companions, "FOTO", "modified"))).toEqual(["foto.jpg"]);
  });

  test("search matches the extracted text of the file", () => {
    expect(names(attachmentsFor(files, companions, "haveforeningens", "modified"))).toEqual(["brev.pdf"]);
  });

  test("search covers all of a file's extracted text, not just its start", () => {
    expect(names(attachmentsFor(files, companions, "sommerfest", "modified"))).toEqual(["brev.pdf"]);
  });

  test("title sort is by name", () => {
    expect(names(attachmentsFor(files, companions, "", "title"))).toEqual(["brev.pdf", "foto.jpg"]);
  });
});

describe("formatSize", () => {
  test("bytes, kilobytes, megabytes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
