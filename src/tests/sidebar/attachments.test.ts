import { describe, expect, test } from "vitest";
import {
  AttachmentFile,
  attachmentFolderMatcher,
  attachmentsFor,
  formatSize,
  isCompanion,
} from "../../sidebar/core/attachments";
import { note } from "./fixtures";

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

describe("isCompanion", () => {
  const m = attachmentFolderMatcher("./Attachments");
  test("extracted text is a companion wherever it lives", () => {
    expect(isCompanion(note("Work/x.md", { extracted: true }), m)).toBe(true);
  });
  test("any note inside an attachments folder is a companion", () => {
    expect(isCompanion(note("Work/Attachments/x.md"), m)).toBe(true);
  });
  test("an ordinary note is not", () => {
    expect(isCompanion(note("Work/x.md"), m)).toBe(false);
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
  const companions = new Map([
    ["A/Attachments/brev.pdf", note("A/Attachments/brev.md", { searchText: "afgørelse om samvær" })],
  ]);
  const names = (list: AttachmentFile[]) => list.map((f) => f.name);

  test("newest first by default", () => {
    expect(names(attachmentsFor(files, companions, "", "modified"))).toEqual(["foto.jpg", "brev.pdf"]);
  });

  test("search matches the file name", () => {
    expect(names(attachmentsFor(files, companions, "FOTO", "modified"))).toEqual(["foto.jpg"]);
  });

  test("search matches the extracted text of the file", () => {
    expect(names(attachmentsFor(files, companions, "samvær", "modified"))).toEqual(["brev.pdf"]);
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
