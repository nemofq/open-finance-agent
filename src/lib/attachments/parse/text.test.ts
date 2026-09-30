import { describe, expect, it } from "vitest";
import { MAX_TEXT_CHARS } from "../limits";
import { capText, decodeText, outlineFromMarkdown, parse } from "./text";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("decodeText", () => {
  it("drops a UTF-8 BOM", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("# Title")]);
    expect(decodeText(bytes)).toEqual({ text: "# Title", warnings: [] });
  });

  it("reads UTF-16 in either byte order", () => {
    const little = Uint8Array.from([0xff, 0xfe, ...Buffer.from("héllo", "utf16le")]);
    const big = Uint8Array.from([0xfe, 0xff, ...Buffer.from("héllo", "utf16le").swap16()]);
    expect(decodeText(little).text).toBe("héllo");
    expect(decodeText(big).text).toBe("héllo");
  });

  it("falls back to Latin-1 when the bytes are not UTF-8, and says so", () => {
    // A lone 0xe9 is "é" in Latin-1 and an invalid sequence in UTF-8.
    const { text, warnings } = decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]));
    expect(text).toBe("café");
    expect(warnings).toEqual([expect.stringContaining("Latin-1")]);
  });

  it("normalises CRLF and lone CR", () => {
    expect(decodeText(utf8("a\r\nb\rc")).text).toBe("a\nb\nc");
  });
});

describe("capText", () => {
  it("truncates instead of failing", () => {
    const capped = capText("x".repeat(MAX_TEXT_CHARS + 10));
    expect(capped.text).toHaveLength(MAX_TEXT_CHARS);
    expect(capped.truncated).toBe(true);
    expect(capped.warnings).toEqual([expect.stringContaining("2,000,000")]);
  });

  it("leaves text within the cap alone", () => {
    expect(capText("short")).toEqual({ text: "short", warnings: [], truncated: false });
  });
});

describe("outlineFromMarkdown", () => {
  it("records every heading with its level", () => {
    const markdown = "# Quarterly memo\n\nBody.\n\n## Segments\n\n### Cloud\n";
    expect(outlineFromMarkdown(markdown)).toEqual([
      { part: 0, level: 1, title: "Quarterly memo" },
      { part: 0, level: 2, title: "Segments" },
      { part: 0, level: 3, title: "Cloud" },
    ]);
  });

  it("ignores hashes inside fenced code", () => {
    const markdown = "# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n";
    expect(outlineFromMarkdown(markdown).map((entry) => entry.title)).toEqual(["Real", "Also real"]);
  });

  it("closes a fence only on the character it was opened with", () => {
    const markdown = "~~~\n```\n# still code\n~~~\n\n# out\n";
    expect(outlineFromMarkdown(markdown).map((entry) => entry.title)).toEqual(["out"]);
  });

  it("strips closing hashes and takes the part it is given", () => {
    expect(outlineFromMarkdown("## Segments ##", 3)).toEqual([{ part: 3, level: 2, title: "Segments" }]);
  });
});

describe("parse", () => {
  it("returns one document part and its outline", async () => {
    const parsed = await parse(utf8("# Q3\n\nRevenue rose 12%.\n"), "memo.md");
    expect(parsed).toEqual({
      version: 1,
      kind: "document",
      parts: [{ type: "text", label: "Document", markdown: "# Q3\n\nRevenue rose 12%." }],
      outline: [{ part: 0, level: 1, title: "Q3" }],
      warnings: [],
    });
  });

  it("keeps front matter as text", async () => {
    const parsed = await parse(utf8("---\ntitle: Q3\n---\n\n# Q3\n"), "memo.md");
    expect(parsed.parts[0]).toMatchObject({ markdown: "---\ntitle: Q3\n---\n\n# Q3" });
  });

  it("reads a file whose bytes are not text without failing", async () => {
    const parsed = await parse(Uint8Array.from([0xff, 0x00, 0xfe, 0x41]), "notes.txt");
    expect(parsed.warnings).toEqual([expect.stringContaining("Latin-1")]);
    expect(parsed.parts).toHaveLength(1);
  });

  it("names an empty file in a warning", async () => {
    const parsed = await parse(utf8("   \n\n"), "notes.txt");
    expect(parsed.parts[0]).toMatchObject({ markdown: "" });
    expect(parsed.warnings).toEqual(["notes.txt has no text."]);
  });

  it("truncates an oversized file rather than throwing", async () => {
    const parsed = await parse(utf8("# Title\n".padEnd(MAX_TEXT_CHARS + 100, "x")), "huge.md");
    expect(parsed.parts[0]).toMatchObject({ markdown: expect.stringMatching(/^# Title/) });
    expect((parsed.parts[0] as { markdown: string }).markdown).toHaveLength(MAX_TEXT_CHARS);
    expect(parsed.warnings).toEqual([expect.stringContaining("2,000,000")]);
    expect(parsed.truncated).toBe(true);
  });
});
