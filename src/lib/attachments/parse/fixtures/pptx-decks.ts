/**
 * Small pptx packages built with jszip, so a fixture is the XML the test is about rather than an
 * opaque binary. Only the parts the parser reads are written: the presentation, its relationships,
 * one slide per spec and the notes slide behind it.
 */
import JSZip from "jszip";

export interface Bullet {
  /** Outline level, 0 outermost. */
  level?: number;
  text: string;
}

interface SlideSpec {
  title?: string;
  bullets?: Bullet[];
  /** Rows of cells; the first row is the table header. */
  table?: string[][];
  notes?: string;
  /** Raw XML appended to the shape tree, for input a well-behaved writer would never produce. */
  extraShapes?: string;
}

interface PptxSpec {
  slides: SlideSpec[];
  /** Writes the slides to their file names in reverse, so file order contradicts slide order. */
  reverseFileNames?: boolean;
  /** Prefixed to every slide's XML, e.g. a DOCTYPE that declares an entity. */
  doctype?: string;
  /** Extra zip entries, for the entry-count cap. */
  filler?: number;
}

const PRESENTATION_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shape(placeholder: string, paragraphs: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${placeholder}"/><p:cNvSpPr/><p:nvPr><p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>`;
}

function paragraph(text: string, level = 0): string {
  const properties = level > 0 ? `<a:pPr lvl="${level}"/>` : "";
  return `<a:p>${properties}<a:r><a:rPr lang="en-US"/><a:t>${escape(text)}</a:t></a:r></a:p>`;
}

function tableXml(rows: string[][]): string {
  const cells = (row: string[]) =>
    row.map((cell) => `<a:tc><a:txBody><a:bodyPr/>${paragraph(cell)}</a:txBody></a:tc>`).join("");
  const body = rows.map((row) => `<a:tr h="370840">${cells(row)}</a:tr>`).join("");
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function slideXml(slide: SlideSpec, doctype = ""): string {
  const shapes = [
    slide.title ? shape("title", paragraph(slide.title)) : "",
    slide.bullets?.length
      ? shape("body", slide.bullets.map((bullet) => paragraph(bullet.text, bullet.level ?? 0)).join(""))
      : "",
    slide.table ? tableXml(slide.table) : "",
    slide.extraShapes ?? "",
    // Furniture every real deck carries and no reader wants to see in the text.
    shape("sldNum", '<a:p><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p>'),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${doctype}<p:sld ${PRESENTATION_NS}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
}

function notesXml(notes: string): string {
  const thumbnail = shape("sldImg", paragraph("the slide thumbnail, which carries no text"));
  const body = shape("body", notes.split("\n").map((line) => paragraph(line)).join(""));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${PRESENTATION_NS}><p:cSld><p:spTree>${thumbnail}${body}</p:spTree></p:cSld></p:notes>`;
}

export async function buildPptx(spec: PptxSpec): Promise<Uint8Array> {
  const zip = new JSZip();
  const count = spec.slides.length;
  /** The file a slide is written to; reversed, the names say the opposite of the slide list. */
  const fileOf = (index: number) => (spec.reverseFileNames ? count - index : index + 1);

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  const slideIds = spec.slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
    .join("");
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${PRESENTATION_NS}><p:sldIdLst>${slideIds}</p:sldIdLst></p:presentation>`,
  );
  const relationships = spec.slides
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${fileOf(index)}.xml"/>`,
    )
    .join("");
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`,
  );

  spec.slides.forEach((slide, index) => {
    const file = fileOf(index);
    zip.file(`ppt/slides/slide${file}.xml`, slideXml(slide, spec.doctype));
    if (slide.notes === undefined) return;
    zip.file(`ppt/notesSlides/notesSlide${file}.xml`, notesXml(slide.notes));
    zip.file(
      `ppt/slides/_rels/slide${file}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${file}.xml"/></Relationships>`,
    );
  });

  for (let index = 0; index < (spec.filler ?? 0); index += 1) zip.file(`ppt/media/filler${index}.bin`, "0");
  return zip.generateAsync({ compression: "DEFLATE", type: "uint8array" });
}

/**
 * Rewrites the uncompressed size every central directory record declares. A zip bomb is exactly
 * this lie, and the parser's cap reads the declaration, so the fixture needs no real payload.
 */
export function declareUncompressedSize(zip: Uint8Array, bytes: number): Uint8Array {
  const patched = Uint8Array.from(zip);
  const view = new DataView(patched.buffer);
  for (let offset = 0; offset + 30 <= patched.length; offset += 1) {
    const signature = view.getUint32(offset, true);
    // 0x02014b50 is "PK\x01\x02", the central directory record; its size fields sit at +20 and +24.
    if (signature === 0x02014b50) view.setUint32(offset + 24, bytes, true);
  }
  return patched;
}
