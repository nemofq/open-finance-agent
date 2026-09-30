import JSZip from "jszip";
import { claimDocuments, stageDocument } from "./documents";
import type { AttachmentTablePart, ParsedAttachment, StoredAttachment } from "./types";

/**
 * Fixtures for the model path's tests: a document attached the way the app attaches one, and the
 * two file formats those tests need to build by hand. Nothing in the app imports this file.
 */

/** Upload a file and send it, exactly as `POST /api/attachments` and the message route would. */
export async function attachDocument(sessionId: string, name: string, bytes: string | Uint8Array): Promise<StoredAttachment> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const staged = await stageDocument(data, name);
  const [claimed] = await claimDocuments(sessionId, [staged.stored.attachment]);
  return claimed;
}

/* ------------------------------------------------------------------ docx */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** One section of a memo: a heading and the paragraphs under it. */
interface DocxSection {
  heading: string;
  paragraphs: string[];
}

/** A real, if minimal, docx package: mammoth reads it exactly as it reads one Word wrote. */
export async function docxOf(sections: DocxSection[]): Promise<Uint8Array> {
  const body = sections
    .map(({ heading, paragraphs }) =>
      [
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escape(heading)}</w:t></w:r></w:p>`,
        ...paragraphs.map((text) => `<w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p>`),
      ].join(""),
    )
    .join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", PACKAGE_RELS);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/* ------------------------------------------------------- parses in memory */

/** A parse with one prose part, for the digest and budget tests that need no disk. */
export function textParse(markdown: string, label = "Document", kind: ParsedAttachment["kind"] = "document"): ParsedAttachment {
  return { version: 1, kind, parts: [{ type: "text", label, markdown }], outline: [], warnings: [] };
}

export function tablePart(label: string, columns: string[], rows: AttachmentTablePart["rows"], totalRows = rows.length): AttachmentTablePart {
  return { type: "table", label, columns, rows, totalRows };
}

/** The descriptor the transcript would hold for a parse, without going through the store. */
export function describe(parsed: ParsedAttachment, name: string, patch: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    attachment: `${"a".repeat(40)}.${name.split(".").pop() ?? "txt"}`,
    name,
    kind: parsed.kind,
    bytes: 1_024,
    tokens: 200,
    parts: parsed.parts.length,
    ...patch,
  };
}
