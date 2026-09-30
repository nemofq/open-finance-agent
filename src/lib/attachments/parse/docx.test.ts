import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MAX_TEXT_CHARS, MAX_ZIP_DECOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from "../limits";
import { parse } from "./docx";

/* ------------------------------------------------------------- fixtures */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

/** One bullet list definition, which is what `w:numId="1"` in the body refers to. */
const NUMBERING = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const heading = (level: number, text: string): string =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const bullet = (text: string): string =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (cells: string[]): string =>
  `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`;
const table = (rows: string[][]): string => `<w:tbl>${rows.map(row).join("")}</w:tbl>`;

function document(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/** A real, if minimal, docx package: mammoth reads it exactly as it reads one Word wrote. */
async function docx(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", PACKAGE_RELS);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
  zip.file("word/numbering.xml", NUMBERING);
  zip.file("word/document.xml", document(body));
  return zip.generateAsync({ type: "uint8array" });
}

const memo = [
  heading(1, "Quarterly memo"),
  paragraph("Revenue rose 12%."),
  heading(2, "Segments"),
  bullet("Cloud"),
  bullet("Devices"),
  table([
    ["Segment", "Revenue"],
    ["Cloud", "46743"],
  ]),
].join("");

/** Rewrites the first central directory entry's declared size: how a zip bomb announces itself. */
function declareSize(bytes: Uint8Array, size: number): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  for (let index = 0; index + 4 <= copy.length; index++) {
    if (view.getUint32(index, true) === 0x02014b50) {
      view.setUint32(index + 24, size, true);
      return copy;
    }
  }
  throw new Error("no central directory in the fixture");
}

/* ------------------------------------------------------------- tests */

describe("parse", () => {
  it("keeps headings, lists and tables", async () => {
    const parsed = await parse(await docx(memo), "memo.docx");
    expect(parsed.kind).toBe("document");
    expect(parsed.parts).toHaveLength(1);
    expect(parsed.parts[0]).toMatchObject({
      type: "text",
      label: "Document",
      markdown: [
        "# Quarterly memo",
        "",
        "Revenue rose 12%.",
        "",
        "## Segments",
        "",
        "- Cloud",
        "- Devices",
        "",
        "| Segment | Revenue |",
        "| ------- | ------- |",
        "| Cloud   | 46743   |",
      ].join("\n"),
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("records the outline the headings describe", async () => {
    const parsed = await parse(await docx(memo), "memo.docx");
    expect(parsed.outline).toEqual([
      { part: 0, level: 1, title: "Quarterly memo" },
      { part: 0, level: 2, title: "Segments" },
    ]);
  });

  it("names a document with no text in a warning", async () => {
    const parsed = await parse(await docx(""), "blank.docx");
    expect(parsed.parts[0]).toMatchObject({ markdown: "" });
    expect(parsed.warnings).toEqual(["blank.docx has no text."]);
  });

  it("truncates an oversized document rather than throwing", async () => {
    const parsed = await parse(await docx(paragraph("x".repeat(MAX_TEXT_CHARS + 10))), "huge.docx");
    expect((parsed.parts[0] as { markdown: string }).markdown).toHaveLength(MAX_TEXT_CHARS);
    expect(parsed.truncated).toBe(true);
  });

  it("refuses a damaged archive", async () => {
    const bytes = await docx(memo);
    await expect(parse(bytes.slice(0, bytes.length - 40), "damaged.docx")).rejects.toThrow(/damaged/);
  });

  it("refuses an archive with too many entries, before anything is inflated", async () => {
    const zip = new JSZip();
    for (let index = 0; index <= MAX_ZIP_ENTRIES; index++) zip.file(`f${index}.txt`, "x");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parse(bytes, "bomb.docx")).rejects.toThrow(/bomb\.docx holds [\d,]+ zip entries/);
  });

  it("refuses an archive that declares more than the decompression cap", async () => {
    const bytes = declareSize(await docx(memo), MAX_ZIP_DECOMPRESSED_BYTES + 1);
    await expect(parse(bytes, "bomb.docx")).rejects.toThrow(/unpacks to more than 200 MB/);
  });

  it("refuses an archive that is not a Word package", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", "not a document");
    await expect(parse(await zip.generateAsync({ type: "uint8array" }), "notes.docx")).rejects.toThrow(
      /could not be read as a Word document/,
    );
  });
});
