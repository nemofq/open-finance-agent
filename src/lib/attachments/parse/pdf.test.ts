import { describe, expect, it } from "vitest";
import { MAX_TEXT_CHARS, SCANNED_PAGE_MIN_CHARS } from "../limits";
import { buildPdf, type PdfSpec } from "./fixtures/pdf-documents";
import { parse, scannedPages } from "./pdf";

const read = (spec: PdfSpec) => parse(buildPdf(spec), "report.pdf");

const markdownOf = (parsed: Awaited<ReturnType<typeof parse>>, part: number) => {
  const found = parsed.parts[part];
  return found?.type === "text" ? found.markdown : "";
};

/** Long enough to clear the scanned-page threshold without saying anything. */
const PROSE = "Operating income rose across every reported segment this quarter.";

describe("parsing a pdf", () => {
  it("orders items on a line left to right, whatever order the page draws them in", async () => {
    const parsed = await read({
      pages: [
        {
          runs: [
            { text: "right column", x: 320, y: 700 },
            { text: "left column", x: 72, y: 700 },
            { text: "the line below", x: 72, y: 686 },
          ],
        },
      ],
    });

    expect(parsed.kind).toBe("pdf");
    expect(parsed.parts[0]?.label).toBe("Page 1");
    expect(markdownOf(parsed, 0)).toBe("left column right column\nthe line below");
  });

  it("starts a paragraph where the vertical gap jumps", async () => {
    const parsed = await read({
      pages: [
        {
          runs: [
            { text: "first paragraph", x: 72, y: 700 },
            { text: "still the first", x: 72, y: 686 },
            { text: "a second paragraph", x: 72, y: 600 },
          ],
        },
      ],
    });

    expect(markdownOf(parsed, 0)).toBe("first paragraph\nstill the first\n\na second paragraph");
  });

  it("gives every page a part and lists the pages with no text layer", async () => {
    const parsed = await read({
      pages: [
        { runs: [{ text: PROSE, x: 72, y: 700 }] },
        { runs: [] },
        { runs: [{ text: "short", x: 72, y: 700 }] },
      ],
    });

    expect(parsed.parts.map((part) => part.label)).toEqual(["Page 1", "Page 2", "Page 3"]);
    expect(markdownOf(parsed, 1)).toBe("");
    expect("short".length).toBeLessThan(SCANNED_PAGE_MIN_CHARS);
    expect(scannedPages(parsed)).toEqual([2, 3]);
    expect(parsed.scannedParts).toEqual([2, 3]);
    expect(parsed.warnings).toEqual(["No text layer on pages 2, 3; they are probably scanned images."]);
  });

  it("maps the document outline onto the pages it opens", async () => {
    const parsed = await read({
      outline: [
        { page: 1, title: "Overview" },
        { page: 3, title: "Segment results" },
      ],
      pages: [1, 2, 3].map((page) => ({ runs: [{ text: `${PROSE} ${page}`, x: 72, y: 700 }] })),
    });

    expect(parsed.outline).toEqual([
      { level: 1, part: 0, title: "Overview" },
      { level: 1, part: 2, title: "Segment results" },
    ]);
  });

  it("has no outline when the document has none", async () => {
    const parsed = await read({ pages: [{ runs: [{ text: PROSE, x: 72, y: 700 }] }] });

    expect(parsed.outline).toEqual([]);
    expect(scannedPages(parsed)).toEqual([]);
  });

  it("truncates at the text cap instead of failing", async () => {
    const parsed = await read({
      pages: [{ runs: [{ text: "x".repeat(MAX_TEXT_CHARS + 100), x: 72, y: 700 }] }, { runs: [] }],
      // A page the long line fits on: pdf.js reports only the glyphs that land on the page.
      width: 10 * MAX_TEXT_CHARS,
    });

    expect(parsed.parts).toHaveLength(1);
    expect(markdownOf(parsed, 0)).toHaveLength(MAX_TEXT_CHARS);
    expect(parsed.truncated).toBe(true);
    expect(parsed.warnings).toContainEqual(expect.stringMatching(/^Stopped at page 1 of 2/));
  });

  it("explains a password-protected file and a file that is not a pdf", async () => {
    const protectedPdf = buildPdf({ encrypted: true, pages: [{ runs: [{ text: PROSE, x: 72, y: 700 }] }] });

    await expect(parse(protectedPdf, "report.pdf")).rejects.toThrow(
      "report.pdf is password-protected. Remove the password and attach it again.",
    );
    await expect(parse(new Uint8Array([1, 2, 3, 4]), "report.pdf")).rejects.toThrow(
      "report.pdf is not a readable PDF file.",
    );
  });

  it("reports nothing for a file that is not a pdf at all", () => {
    expect(scannedPages({ kind: "document", outline: [], parts: [], version: 1, warnings: [] })).toEqual([]);
  });
});
